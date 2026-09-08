# Fable's review of the thirteen, as built

The shortlist ([260907f-logo-animations-shortlist.md](260907f-logo-animations-shortlist.md)) was
mine; this is me checking the build against it, on screen, on 2026-09-07. Ordered by what to act on
first. Each item is **must** (wrong, will be seen), **should** (adequate now, good after), or
**taste**. Every change comes with the CSS or the prose.

**How I looked.** `/design` is behind sign-in, so I injected the gallery's exact markup
(`DesignPage.tsx § LogoGlyph`, same classes) into `/privacy`, which shares the stylesheet bundle,
paused each animation at its telling frame with `getAnimations()`, and screenshotted at 3× device
pixels. Four things were measured rather than eyeballed and each is cited where it lands: the
seating of the two `--logo-pad` pseudo-elements, what the mark does the frame after its class is
removed, what the guard's rules leave of each pseudo-element, and where the `n`'s glyph sits in its
box (7px below the box top in Trebuchet, 6px in Geist; baseline at 14px and 13px; box 20.34px tall
because `body`'s `line-height: 1.55` reaches the letters). I did not see the dock copy live.

**The headline.** The set is right at thirteen and nothing needs replacing. Six of them need a
number changed now that they exist, two are wrong under reduced motion, and the gallery
misrepresents two — one of them badly enough that a reviewer would call the animation broken.

---

## 1. must — two threads are fully drawn under reduced motion

`spya-abseil`'s `::before` and `spya-dragline`'s `::before` both animate `transform: scaleY()`
from 0, and neither declares a resting `transform`. Under the guard (0.01ms, one iteration, fill
`none`) each animation finishes and the pseudo reverts to its base style, which has no transform —
so the thread is at full 8px length, opacity 0.6/0.7, for as long as the pointer rests there, above a
letter and a spider that are both at rest. Reproduced by injecting the guard's three rules ungated:
both computed `transform: none`, `height: 8px`. The shortlist wrote `transform: scaleY(0)` as a
static declaration on both (§ 11, § 12) and it was dropped in transcription; the seam's thread
survived because it was rewritten with `both`, which happens to cover it.

This is the same class as the four the browser check found — a pseudo doing exactly what it says
against a state nobody looked at — and it is the third pseudo-element rule in this file to have
lost a line on the way in.

```css
.spya-abseil .logo-letter:nth-child(10)::before {
  /* … */
  transform: scaleY(0);          /* the resting state; the guard lands here */
  transform-origin: top;
  animation: spya-abseil-thread 2s infinite;
}
.spya-dragline::before {
  /* … */
  transform: scaleY(0);
  transform-origin: top;
  animation: spya-dragline-thread 1.6s ease-in-out infinite;
}
```

And a test, because this has now happened three times (§ 11 below has it).

## 2. must — the gallery draws a second spider

`--logo-pad` defaults to `0.7rem` on `.spya-anim`, which is the corner copy's padding. The gallery's
`.logo` has no padding at all, so `spya-radius`'s overlay sits at `left: 11.2px` over an image at
`0`, and `spya-dragline`'s thread at `21.2px` against a spider whose centre is at `10`. Measured, and
visible in the screenshot: the radius cell shows **two overlapping spiders**, the right one
two-tone, and the dragline's thread hangs in the gap in front of the `S`. In the app both are seated
correctly; the gallery, which is the review surface, lies about exactly the two expensive ones.

Give the gallery the corner's geometry rather than zeroing the token, so it draws the copy it claims
to:

```css
/* design-page.css — replaces the existing align-self rule */
/* The corner copy's padding, and it is not cosmetic: two animations seat a
   pseudo-element at `--logo-pad`, which is the anchor's own left padding, and a
   bare `.logo` with none put the radius overlay and the dragline thread 11px to
   the right of the spider — a second, two-tone spider beside the first
   (Fable's review, 2026-09-07). The gallery draws the corner copy's geometry
   or it draws a different thing. */
.design-logo-cell .logo { align-self: flex-start; padding: 0 0.7rem; }
```

## 3. should — the abseil thread stops 7px short of the `n`

The thread is anchored at `top: -8px; height: 8px`, so it runs from the letter's *box* top down to
the box top — and the `n`'s glyph starts 7px below its box top (x-height in a 20.34px line box). At
the hang, the thread ends at the original box top + 8 and the letter's visible top is at + 15: a 7px
gap between the end of the yarn and the thing hanging from it. In the screenshot the thread floats
above the cap-line and the `n` is well below it; it reads as two unrelated marks. Start the thread
where the letter's top *was* and it joins where the letter's top *is*:

```css
.spya-abseil .logo-letter:nth-child(10)::before {
  content: "";
  position: absolute;
  left: 50%;
  /* From the top of the `n` as it was to the top of the `n` as it is: the
     glyph's top sits about 0.5em below the box top in both faces (7px of 13.12
     in Trebuchet, 6px in Geist), and the pseudo rides down with the letter. */
  top: calc(0.5em - 8px);
  width: 1px;
  height: 8px;
  /* … */
}
```

The vertical budget claim also wants correcting where it is written (§ 12): the letter box's bottom
is at 30.2px in the 40px bar, not 26.5, so 8px clears the clip by **1.8px**, not five. Still fits;
now genuinely the ceiling.

## 4. should — the seam's thread is an en dash

At `top: 55%`, 6px wide, 1px tall, in the gap between `r` and `y`, the thread is a hyphen: the
screenshot reads **Spider–yarn** and a reader will too. "Stretched taut" and "straight line at
x-height" are the same thing, and the second is punctuation. Give it weight — a shallow sag is what
no glyph in the font does:

```css
.spya-seam .logo-letter:nth-child(6)::after {
  content: "";
  position: absolute;
  left: 100%;
  top: 46%;
  width: 6px;
  height: 3px;
  /* A curved hairline, not a filled box: only the bottom edge is drawn and
     the radius bends it into a 2px sag. A straight 6px line here is an en
     dash (Fable's review, 2026-09-07). */
  border-bottom: 1px solid var(--highlight);
  border-radius: 0 0 50% 50% / 0 0 100% 100%;
  opacity: 0.6;
  transform-origin: left;
  animation: spya-seam-thread 240ms 180ms cubic-bezier(0.2, 0.8, 0.2, 1) 1 both;
}
```

Look at it at 1×. If the sag is too small to read there, do not raise the line — drop it to
`top: 68%` so it sits just above the baseline as a stitch, which is at least not a dash.

## 5. should — Pluck does not travel; it bobs

My numbers, and they were wrong. Stagger 28ms across ten letters is 252ms; the first bump takes 224ms
to rise and ~600ms to decay through the second and third. A bump 600ms long moving 28ms per letter
is **21 letters wide** — the whole word lifts as one, 2px, then 1, then 0.5, with a faint tilt. The
paused frame confirms it: every letter is up at once. What is on screen is a slow bob at ~2.6Hz,
which is the "tired micro-interaction" the entry warned against.

A plucked string does not send a bump down its length; it oscillates about rest on both sides and
decays. Make it that, and make it fast enough to be a vibration:

```css
.spya-pluck .logo-letter {
  animation: spya-pluck 1.4s ease-in-out infinite;
  /* 34ms × 9 = 306ms across the word: the S is on its second swing when the n
     starts its first, so the row visibly skews rather than lifting in unison —
     without pretending a bump this long can travel. */
  animation-delay: calc(var(--i) * 34ms);
}
@keyframes spya-pluck {
  0%, 62%, 100% { transform: none; }
  8%  { transform: translateY(-2px); }
  20% { transform: translateY(1px); }
  31% { transform: translateY(-1px); }
  42% { transform: translateY(0.5px); }
  52% { transform: translateY(-0.3px); }
}
```

Half-period ≈ 160ms (about 3Hz) — a tremble, not a bounce; five swings of falling height, alternating
sides; 530ms rest. Amplitude stays inside the 2px / 1px / 0.5px envelope the entry set, and +1px below
the baseline is within the dock's clip.

## 6. should — Misregistration's plates pop in left to right

`forwards` fills only after the delay. So for letter `n`, nothing is drawn for 180ms and then two
plates *appear* 1.5px off and converge — across the word that is a wave of plates arriving S → n,
which is the glitch reading the entry was written to avoid. The plates should all be there at
hover-in; the *lock* is what travels.

```css
animation: spya-register 640ms cubic-bezier(0.16, 1, 0.3, 1) 1 both;
```

Reduced motion with `both`: each letter shows its `from` frame for the length of its delay
(≤180ms) and snaps to zero — a doubled word for under a fifth of a second, then the base style. Say
so in the block; it is a still with a brief preface, not a compromise.

## 7. should — The Spider Strains reads as a crooked icon at the hold

The risk the entry named, and at the paused 45% frame it is what I see: `rotate(-10deg)
translateX(-2px) scaleX(1.1)` on a 20px silhouette is a slightly tilted spider, and a 684ms
`ease-in-out` lean into a 250ms *static* hold gives it no effort. A strain shudders. Arrive sooner,
lean further, tremble in the hold, recoil harder:

```css
@keyframes spya-strain {
  0%, 84%, 100% { transform: none; }
  26% { transform: translateX(-3px) rotate(-14deg) scaleX(1.12); }
  34% { transform: translateX(-3.5px) rotate(-15deg) scaleX(1.16); }
  42% { transform: translateX(-3px) rotate(-14deg) scaleX(1.12); }
  50% { transform: translateX(-3.5px) rotate(-15deg) scaleX(1.16); }
  58% { transform: translateX(-3px) rotate(-14deg) scaleX(1.12); }
  70% { transform: rotate(5deg); }
}
@keyframes spya-strain-hold {
  0%, 56%, 100% { color: var(--highlight); }
  68%, 82% { color: var(--highlight-ink); }
}
```

The letters now brighten *after* it lets go (58%) rather than during the hold (45%), which was the
order the entry described. Budget in the dock: 15° about `60% 50%` moves a corner ≤3.5px vertically
against 10px of headroom; `scaleX(1.16)` is 23.2px wide, 1.3px into the 6.4px gap;
`translateX(-3.5px)` is inside the 9.6px padding.

**If it still reads as crooked after this, swap it** — see § 13 for the replacement, written.

## 8. should — the block cursor floats above the caps

`top: 0.12em; height: 0.85em` spans 1.6px → 12.7px of the box; the caps run 5px → 14px (Trebuchet)
and 4px → 13px (Geist). The cursor starts 3.4px above cap height and stops 1.3px short of the
baseline — a terminal cursor sits *on* the baseline.

```css
top: 0.36em;
height: 0.7em;
```

4.7px → 13.9px in both faces.

## 9. should — the "soft exit for the mark" is only true of The Settle

Measured: pause `spya-dragline` at 44% (`translateY(8px)`), remove both classes, sample — the
computed transform is `none` in the same frame and every frame after, with `transition-duration:
0.22s` sitting right there on the element. A transition does not start from a value an animation
was supplying; when the animation goes, the value snaps. `spya-settle`'s exit works because it is a
transition both ways (measured easing back over 250ms). So the resting `.logo-image { transition }`
serves one animation, not "wherever an animation left it", and the base-block comment, the header's
"there is no exit transition to be had" and the shortlist's § 0 disagree with each other about it.

Keep the rule; it is what gives the Settle its exit. Replace the comment:

> **A soft landing for The Settle, and only for it.** It is a transition both ways, so removing the
> class eases the mark home along this gentler curve. It does nothing for the keyframe animations:
> when their class goes, the animated value goes with it in the same frame and there is nothing to
> transition *from* (measured on `spya-dragline`, 2026-09-07) — so those all end at whatever pose
> they were in, which is why each of them returns to rest inside its own loop and none holds a pose
> far from it.

And state the consequence honestly in the header: a keyframe animation cut off by pointer-leave
snaps from its current frame, full stop. It was already the design — the "start and end at rest"
rule is its mitigation — but the file currently promises an ease it does not deliver.

## 10. should — two gaps in the trigger

- **A stale `suppressClick` swallows the next click.** Hold the mouse on the wordmark 350ms (the
  flag is set), drag off before releasing: no `click` fires on the anchor, the flag stays true, and
  the reader's next ordinary click on the way home does nothing, once. The same on touch if the
  browser cancels the click after a long press (iOS does). Clear it wherever the gesture is
  abandoned: in `onPointerLeave` (the mouse branch), `onPointerCancel`, and the linger timeout.
- **Android opens the link's context sheet on top of the long press.** `-webkit-touch-callout` is
  iOS-only; Chrome on Android fires `contextmenu` at ~500ms and shows *Open in new tab / Copy link*
  over the animation the reader just asked for. Add `onContextMenu: (e) => { if (pressedByTouch.current) e.preventDefault(); }`
  with a ref set from `pointerType` in `onPointerDown`. Not verified on a device — there is no
  Android here — but it is what Chrome does with a held link, and `user-select: none` does not
  stop it.

## 11. should — two tests the browser check would have wanted

Both are regexes over `RULES`, both name a failure this feature has now had.

```ts
it("defines a @keyframes block for every animation it runs", () => {
  /* A typo in an animation name is a silent no-op: the rule parses, the class
     lands, nothing moves. */
  const defined = new Set([...RULES.matchAll(/@keyframes\s+([a-z0-9-]+)/g)].map((m) => m[1]));
  const used = [...RULES.matchAll(/animation:\s*([a-z][a-z0-9-]*)/g)].map((m) => m[1]);
  expect(used.filter((n) => !defined.has(n))).toEqual([]);
});

it("gives every animated pseudo-element a resting transform", () => {
  /* Under the motion guard an animation runs 0.01ms and fills nothing, so a
     `::before` whose only `transform` is in its keyframes reverts to no
     transform at all — a thread drawn at full length above a letter at rest.
     Two of the three thread pseudo-elements shipped this way (Fable's review,
     2026-09-07). */
  const blocks = [...RULES.matchAll(/::(?:before|after)\s*\{([^}]*)\}/g)].map((m) => m[1] as string);
  const offenders = blocks.filter((b) => /animation:/.test(b) && !/(^|;)\s*transform:/.test(b));
  expect(offenders).toEqual([]);
});
```

`spya-type`'s cursor animates `opacity`, not `transform`, so give it `transform: none` explicitly
or scope the second test to blocks whose keyframes touch `transform`; the explicit line is simpler
and costs nothing.

## 12. taste — small wrongs in prose and comments

- `logo-animation.ts:41` — "what `spya-anim-dragline` looks like": the id is `spya-dragline`.
- The stylesheet header lists `spya-i` under `forwards` ("freezes with the `i` a pixel high").
  It is a transition; only `spya-register` and the seam's thread use a forwards fill now that
  `spya-type` is `backwards`. Two, not three — and `design-logo.md` § Adding one says "three" too.
- `spya-abseil`'s block: "the letter box's bottom sits at about 26.5px" → 30.2px, clears by 1.8px.
- `spya-strain`'s block cites `vision.md § Principles` for "the text does not move" — worth
  keeping, but the letters brighten *during* the hold as written, which is not the beat the prose
  describes; § 7 fixes the order.

---

## 13. Additions and cuts

**Thirteen is right. Nothing comes in, nothing goes out.** The three named replacements were each
conditional on a sibling disappointing, and after the fixes above none does:

- **The Letters Don't Care** was the replacement for *The Spider Strains* if the lean did not read.
  At the built numbers it does not — but that is a numbers problem (§ 7), not a concept problem, and
  the sharpened version keeps the only animation in the set that is an argument. Hold the
  replacement in reserve, and here it is so the swap is a paste rather than a project:

  ```css
  /* -- The Letters Don't Care -------------------------------------------
     The spider spins once, overshoots, wobbles back, and stops. The letters do
     not acknowledge it. Mark-only, one-shot, ends at 360° which is rest by
     another name — so class removal and the motion guard both land on the
     plain mark. */
  .spya-tumble .logo-image {
    animation: spya-tumble 1.5s cubic-bezier(0.2, 0.7, 0.2, 1) 1;
  }
  @keyframes spya-tumble {
    0%   { transform: rotate(0deg); }
    70%  { transform: rotate(390deg); }
    85%  { transform: rotate(352deg); }
    100% { transform: rotate(360deg); }
  }
  ```

  Register: funny, deadpan. It would take Strain's square in the diversity table exactly (mark,
  looping-gesture → one-shot, funny), and the mark-only count stays at six.
- **Heavy Landing** was the replacement if Dragline's hang looked stiff. It does not: ±2° over
  450ms is a hang, and the thread reads as an orange hairline (the browser check's finding, and
  mine). Not taken.
- **Three Tiers** was the replacement if Pluck disappointed. Pluck did disappoint — but as a bob,
  not as a wave, and § 5 makes it a vibration. Three Tiers' stepped opacity on 13px type is still
  the "rendering fault" risk it was. Not taken.

**On cutting:** *Only the i* is still first in the cut order and still cheap enough to keep. At 3× it
is plainly a raised letter; at 1× it is a pixel, and the entry said so. It stays because thirteen
draws with one repeat-exclusion is a better lottery than twelve, and it costs four lines.

**The set as a whole, on one screen.** The range holds. Three things are quiet enough to miss
(Settle, Warm, i), four are letters-only mechanics that look nothing like each other (Sag's catenary
is the best-looking still on the sheet), two are theatrical drops that are visibly different gestures
even side by side, and Radius, Dawn and Retype each own a register nobody else touches. The one
place the table overclaimed was "travelling wave" for Pluck; § 5 does not make it one, it makes it
a vibration, and the table should say so.

## 14. The two merges and the two sharpenings

- **`spya-settle` (restraint 2 + 3).** Better merged. The diagonal reads as a lean toward the
  corner, and it is the one animation with a real exit; nothing was lost.
- **`spya-register` (styles 11 + tech 10).** The merge is right; the fill mode lost the styles-11
  half of it — "the plates are there and they *converge*" — see § 6.
- **Pluck (sharpened from Ten Delays).** The decay was the sharpening and it survived; the
  travelling was never real at these numbers. § 5.
- **Dawn (made one-shot).** Right call, and the asymmetry is intact in the build — the eat is the
  quick `ease-in`, the respin the slow `ease-out`. The mid-wipe frame at 25% is a soft edge
  eating from the right, which is a wipe in progress and not a broken mark.

---

## 15. Spec versus stylesheet, every difference

| Where | Shortlist | Built | Verdict |
| --- | --- | --- | --- |
| Base | `.dock-home.spya-anim { position: relative }` | `.spya-anim:not(.logo-home)` | Better — the gallery's bare `.logo` needs it too |
| Base | `--logo-pad` default on `.logo-home.spya-anim` | on `.spya-anim` | Fine, and the reason the gallery breaks without § 2 |
| Base | `position: relative` on three host letters | on all ten | Better; known |
| `spya-sag` | ten single selectors | five symmetric pairs | Same |
| `spya-seam` thread | static `scaleX(0)` + `forwards`, keyframe `to` only | no static, `both`, `from`/`to` | Equivalent; `both` covers the delay |
| `spya-dawn` | `mask-position` in keyframes | + `-webkit-mask-position` | Better |
| `spya-type` | `both` | `backwards` | Better; the browser check's fix |
| `spya-abseil` thread | static `transform: scaleY(0)` | **dropped** | § 1 |
| `spya-dragline` thread | static `transform: scaleY(0)` | **dropped** | § 1 |
| `spya-radius` | `@supports (mask-image: linear-gradient(#000, #000))` | `@supports (mask-image: url(""))` | Equivalent in Chrome (checked passes); `url("")` is an odd probe and the gradient form is the one the spike verified — revert if Firefox or Safari ever fails the gate |
| Everything else | — | transcribed exactly | Amplitudes, durations, curves and percentages all match |

So: two dropped lines that matter (§ 1), three transcription choices that improved on the spec, and
no number changed in transit. Every number I now want changed (§ 3–8) was **my** number.

## 16. Anything else actually wrong

Checked and clean, for the record, so nobody re-checks them:

- Nothing changes a box. Width was measured constant by the browser check; nothing here adds to it.
- The dock's scrollable overflow — which the fit ladder reads — is not touched: every transform and
  pseudo stays inside `.dock-home`'s own padding box, and `text-shadow` and `filter` do not count.
- `.spya-anim:not(.logo-home)` holds; the corner stays `fixed`.
- Reduced motion, per animation, with the guard's rules injected: Settle and i snap to the held
  pose; Seam parts with the thread drawn; Register ends transparent; Type ends fully lit with the
  cursor at 0; Radius sits at 0°; Sag, Pluck, Warm, Strain, Dawn are base. Only the two threads of
  § 1 are wrong.
- The 1203×1272 PNG is squashed identically by the `<img>`'s 20×20 and the mask's `20px 20px`, so the
  radius overlay registers with the image.
- `--chat-mark`, `--highlight-ink`, `--highlight` all exist where the sheet is loaded.
- The test's orphan regex would catch a keyframe-only class; it cannot catch a keyframe-name typo,
  which is § 11.

## 17. `design-logo.md`

Mostly right, and it can be shorter. What to change:

- **Wrong:** "`animation-fill-mode: forwards` is allowed only where the 100% frame is a still …
  which three of these rely on" → **two** (`spya-register`, the seam's thread).
- **Overclaimed:** "`prefers-reduced-motion` flattens all of this to nothing" → flattens each to a
  *still*, and the stylesheet names which still, per animation. That is the contract; "nothing"
  is what a reader expects and is not what they get for Settle, Seam or i.
- **Overclaimed:** "The `/design` section that lists them is forty lines" → it is about ninety with
  `LogoGlyph`. Say "small" or say the number and its date.
- **Missing, and the next agent needs it:** the `--logo-pad` contract. Add to § The traps:

  > **A padding change to the wordmark is a change to `--logo-pad`.** Two animations seat a
  > pseudo-element at the spider's centre from that token, declared once in the base block for
  > the three paddings the wordmark is drawn under (corner, dock, dock rung 3) and for the gallery.
  > Change `.logo-home`'s, `.dock-home`'s or rung 3's `padding` without it and the thread and the
  > sweep drift silently; the gallery drew a second spider for exactly this reason.
- **Missing:** the vertical budget as a number. "The dock is 40px tall and clips; the letter box
  is 20.3px and centred, so a letter may drop 8px and the mark 8px, and neither may drop 10."
- **Missing:** the exit story in one line. "Only The Settle eases out. Every keyframe animation
  ends the frame the pointer leaves, from whatever frame it was on — which is why each returns to
  rest inside its own loop."
- **Missing:** that the gallery draws the corner face only (Trebuchet), so a Geist-specific fault
  is not something `/design` can show.
- **Can go:** the paragraph on the previous version's line counts is repeated in
  `logo-animation.ts`, `dock.css` and here. One home; this doc is the right one, the two source
  comments can cite it.

---

Shortlist: [260907f-logo-animations-shortlist.md](260907f-logo-animations-shortlist.md) ·
Browser check: [260907f-logo-animations-browser-check.md](260907f-logo-animations-browser-check.md) ·
The feature: [design-logo.md](../project/design-logo.md)

Up: [plans.md](../project/plans.md)
