# The wordmark's hover animations

Point at the Spideryarn wordmark, or hold it down on a phone, and one of thirteen animations plays
— a different one each time. This is what they are, why there are thirteen rather than one, and the
four ways a new one can silently do nothing.

> Let's have fun with the Spideryarn logo when you hover over it. … Whenever the user hovers or
> long-clicks the Spideryarn logo it should pick a random animation.
>
> — Greg, 2026-09-07

The code is [`src/web/logo-animation.ts`](../../src/web/logo-animation.ts) (the registry, the
picker, the trigger) and [`src/web/styles/logo-animations.css`](../../src/web/styles/logo-animations.css)
(every keyframe, each with its own note). The whole set is drawn at once on **`/design` § Wordmark
animations**, which is the only way to compare a dozen effects that otherwise arrive one at a time
at random.

## Where this came from, and what it deliberately is not

The previous version had this feature: fifteen CSS animations on the same wordmark, and the class
names in our markup are that app's, kept so the idea could be taken up cheaply one day
([original-version/design-system.md § The logo playground](original-version/design-system.md)).
That doc is not admiring. Their version cost about **4,700 lines** — a registry, a `/design/logoplay`
route of 2,807 lines, and 1,911 lines of CSS — and it calls the result *"the clearest example of
scope creep on a cosmetic feature in that repo"*, in an app whose mobile layout was never finished.
Its advice was to hand-write exactly one animation and stop.

Greg overruled that on 2026-09-07, and the overrule is only of the *number*. What we kept is the
diagnosis: **the apparatus was the expensive part, not the animations.** So there is one stylesheet,
one hook, no route of its own, no per-animation component, and the entire registry is one array. The
`/design` section that lists them is small — about ninety lines with the markup helper it shares,
on 2026-09-07 — and it earns them by being the thing that makes review possible at all.

## How the thirteen were chosen

Kept in full under `docs/plans/`, because the reasoning is most of the value and the near-misses are
the first place to look when one of these disappoints on screen.

- **[The brief](../plans/260907f-logo-animations-brief.md)** — the DOM, the constraints, the mark
  itself, and **two corrections** made after the fact: the app is dark-only (the brief said
  otherwise), and the two copies of the wordmark are set in different typefaces.
- **Eight longlists, about 140 ideas**, each written by a subagent given a different framing and
  told to stay in its lane: the product's
  [principles](../plans/260907f-logo-animations-longlist-principles.md), its
  [features](../plans/260907f-logo-animations-longlist-features.md), the
  [spider and the yarn](../plans/260907f-logo-animations-longlist-spider.md), the browser's
  [animation machinery](../plans/260907f-logo-animations-longlist-tech.md), ten schools of
  [motion design](../plans/260907f-logo-animations-longlist-styles.md), the
  [letterforms](../plans/260907f-logo-animations-longlist-letterforms.md),
  [restraint](../plans/260907f-logo-animations-longlist-restraint.md), and
  [wildcards](../plans/260907f-logo-animations-longlist-wildcards.md).
- **[The shortlist](../plans/260907f-logo-animations-shortlist.md)** — Fable's arbitration on ease,
  value and diversity, with a diversity table, ten near-misses, and a cut order.
- **[The browser check](../plans/260907f-logo-animations-browser-check.md)** and
  **[Fable's review of the build](../plans/260907f-logo-animations-fable-review.md)** — what was
  wrong once it existed, which was mostly not what anyone predicted.

**Diversity was scored on the set, not on the idea**, which is the one thing about this exercise
worth carrying to the next one. A reader meets these one at a time in random order, so what they
form an impression of is the *range* — which means the best twelve ideas are not the best set of
twelve. Three individually strong ideas were dropped for holding a square of the grid a sibling
already held: two spiders dropping on a thread is one too many however good both are.

The three axes fought, and the shortlist says where. Twice the fight was worth losing:

- **"Looks broken" beat the best joke.** *What Compression Costs* — six letters winking out to show
  what a summary throws away — is the most Spideryarn idea anybody proposed, and six missing letters
  on a navigation link is a font failure to everyone who does not already know the joke.
- **The median hover is short, so restraint had to be instant.** An effect that waits half a second
  before starting is beautiful in a gallery and invisible to the reader whose pointer rests for
  300ms.

## The two mount points, and the trap between them

The wordmark is drawn **twice**, with deliberately different inner markup:

| | Where | Wrapper round the letters | Face |
| --- | --- | --- | --- |
| `HomeLogo` | fixed top-left, shelf-adjacent pages | `.logo-text` | Geist Variable 600 |
| `DockHome` | left end of the reading view's bottom bar | `.dock-btn-label` | Geist Variable |

Both spread `useLogoAnimation()` onto their `<a>`, so *when* an animation runs has one
implementation. What they do not share is the wrapper class, and that is on purpose: `.logo-text` is
hidden by the 731px query, and the dock's word is owned by the bar's own fit ladder instead
([Dock.tsx § The word, and which mechanism takes it away](../../src/web/Dock.tsx)).

**So the stylesheet selects on `.logo-letter` and `.logo-image` and never on `.logo-text`.** A rule
that reaches for `.logo-text` works perfectly in the corner and does nothing at all on the reading
view, which is the copy most readers see most often. `tests/logo-animation.test.tsx` fails on it.

### The two copies were not the same typeface

Found while writing this, by two agents independently, and not introduced by this work:
[`styles/tokens.css`](../../styles/tokens.css) gave `.logo-text` — the corner copy only —
`--font-brand`, which was Trebuchet MS, while `.dock-btn-label` inherited Geist from `--font-ui`.
So the app's own name was set in a different face depending on which page you were on. Dock.tsx's
own comment claims the two are "same glyph, same word, same colour", and it was right about all
three things it names and silent about the fourth.

**Settled on 2026-09-08.** It was raised to Greg as an observation rather than fixed, on the grounds
that changing the reading view's face is a visible design change nobody asked for; his answer was to
change the *other* one. `--font-brand` now resolves to `--font-sans`, so both copies are Geist and
what still separates them is `.logo-text`'s weight and orange. Two things follow for this file:

- **The variable weight axis is now available to an animation**, which it was not while one copy was
  a two-weight face. Nothing here uses it yet, and anything that does must still be checked in both
  places — `.dock-btn-label` does not set 600, so the two copies start from different weights even
  in one face.
- **`font-weight: 600` is drawn rather than synthesised.** Trebuchet ships 400 and 700 and the
  browser was faux-bolding the wordmark; Geist is variable across 100–900. The corner wordmark is
  very slightly lighter and cleaner than it was, which is the visible half of this change.

## What a phone sees

**On a narrow screen there is no word at all.** `.logo-text` is `display: none` below 731px
([`narrow-window.css`](../../src/web/styles/narrow-window.css)), and the dock's `.dock-btn-label`
goes at **rung 1** — the *first* thing the bar's fit ladder gives up, not the last
([`dock-fit.css`](../../src/web/styles/dock-fit.css) § the fit ladder), because the wordmark is one
of the two words that pay least. Both copies become the 20px spider and nothing else, and they do it
early.

That is why **six of the thirteen animate the mark alone** — a ratio, not an accident. An animation
that lives entirely in the ten letters is a hover that does nothing for every reader on a phone, and
seven of the thirteen are in that class. The picker is uniform anyway for a first version: a null
draw on a small screen is not worth forty lines of conditional weighting, and the fix if it ever
becomes one is to weight the pool rather than to redesign the animations.

## The trigger

[`useLogoAnimation`](../../src/web/logo-animation.ts) returns a class name and a set of `<a>` props.
Three things in it are decisions rather than plumbing.

**A long press is a request to see, not to leave.** Holding the wordmark for 350ms picks an
animation *and* suppresses the click that follows. Without that, a reader who held the logo down to
watch it would be thrown back to the library a tenth of a second later, having lost the page they
were on to look at a spider. It re-rolls with a mouse too, so holding the button down is how you ask
for a second draw without leaving the corner and coming back.

**A touch is not a hover.** A tap on a link fires `pointerenter` immediately before `pointerdown`, so
taking it would mean every tap on the way home started an animation nobody asked for — and would
spend the long press's draw before the long press happened. Both enter and leave ignore
`pointerType === "touch"`; a finger gets the animation only from the hold, and it lingers 4.5s after
release because a finger has no un-hover to end it with.

**The picker never repeats the previous draw.** A uniform draw over thirteen repeats about one hover
in thirteen, and a repeat does not read as chance — it reads as the feature being broken, because
the reader's model is "a new one each time". The exclusion costs nothing and removes the only
outcome that looks like a bug. It is also why the set should not fall below about nine.

## Adding one

Two files and a test. Put the keyframes in
[`logo-animations.css`](../../src/web/styles/logo-animations.css) under a class named `spya-<thing>`,
add the entry to `LOGO_ANIMATIONS`, and run `npm test`. `/design` picks it up with no further edit.

The stylesheet's header carries the rules in full. The four that are worth knowing before you start,
because each of them fails **silently** — the animation looks fine to whoever wrote it and does
nothing for a large group of readers ([silent-success.md](../reusable/silent-success.md)):

1. **Drive it off the class, never off `:hover`.** The class is added three ways: a hover, a long
   press, and `/design` applying it directly. A `:hover` rule serves one of them.
2. **Never select `.logo-text`.** Only the corner copy has it. See above.
3. **Return to the resting state at 100%**, so removing the class cannot strand the wordmark
   mid-gesture — and so the reduced-motion freeze is harmless. `animation-fill-mode: forwards` is
   allowed only where the 100% frame is a still you would be happy to ship, which exactly two of
   these rely on and say so. **A pseudo-element needs its resting `transform` declared statically**,
   not only in its keyframes: the guard fills nothing, so a thread whose `scaleY(0)` lives only at
   `0%` reverts to no transform at all and hangs at full length beside something at rest. That has
   happened three times in this one file and is now a test.
4. **Do not change the element's box.** The dock copy is in a flex row that reflows; the corner copy
   is `position: fixed` over pages that reserved no space for it. Transforms, opacity, filters,
   masks and absolutely-positioned pseudo-elements only.

`tests/logo-animation.test.tsx` enforces 1, 2, and the registry–stylesheet agreement in both
directions. All four of its guards were watched go red before being trusted.

**Only The Settle eases out.** Every keyframe animation here ends the frame the pointer leaves,
from whatever frame it was on, because a transition cannot start from a value an animation was
supplying. That is why "return to rest inside your own loop" is a rule rather than a preference —
it is the only thing standing between a cut-off animation and a visible snap.

**And then look at it in a browser**, because those tests reach none of the things that actually
went wrong here. [The browser check](../plans/260907f-logo-animations-browser-check.md) found four
defects in a stylesheet whose every rule was doing exactly what it said; what was wrong was which
box a rule resolved against, and only a browser knows that. It also confirmed the two mechanisms
most likely to have failed quietly — `@property` interpolating through the Vite build, and
`mask-image: url(/spideryarn-logo.png)` clipping to leg-shaped pixels rather than a box.

Then [Fable reviewed the build against its own spec](../plans/260907f-logo-animations-fable-review.md)
and found two more dropped lines, six of its own numbers that were wrong once they existed rather
than being described, and a claim in this file's stylesheet that was simply false. Its conclusion on
the set is worth keeping: **thirteen is right, and nothing needed replacing** — the three animations
held in reserve were each conditional on a sibling disappointing, and the two that did disappoint
disappointed on numbers rather than on concept.

**`/design` cannot show you everything**, and it could show you less before 2026-09-08 than it can
now. Its gallery draws both wrappers, and until that date they were two different faces, so a fault
specific to Geist was one only the reading view would show you. Both are Geist now (§ The two copies
were not the same typeface), which closes that particular gap and leaves the ones the gallery never
covered: the dock's 40px clip, the coarse-pointer layout, and the narrow window that takes the word
away entirely.

### The traps that cost time here

- **`.spya-anim { position: relative }` overrides `.logo-home { position: fixed }`.** Same
  specificity, and this sheet is imported last, so the corner wordmark drops out of the corner for
  exactly as long as you point at it. The base rule is written `.spya-anim:not(.logo-home)`.
- **An `<img>` is a replaced element and takes no pseudo-element.** Anything that recolours the
  spider paints a box and masks it to the PNG's alpha, which is what `spya-radius` does.
- **`.logo` is `inline-flex`**, so a `::before` becomes a flex item and moves the row unless it is
  absolutely positioned.
- **Both copies already transition `opacity` on hover**, so an animation that also writes `opacity`
  on the anchor fights it. Write opacity on the children.
- **`--i` is not set in the JSX.** The letter index is ten `:nth-child` rules in the base block; a
  stagger written as `calc(var(--i) * 34ms)` without them resolves to an invalid value and the whole
  declaration is dropped, silently.
- **Anything drawn *at* the spider hangs off `.logo-mark`, never off a padding.** That wrapper is a
  box exactly the size of the image, so `inset: 0` on it is the mark wherever a layout has put it.
  The version before it derived the mark's position from the anchor's left padding, which is simply
  false on a touch device — under `pointer: coarse` the dock's wordmark grows and **centres its
  contents** ([`narrow-window.css`](../../src/web/styles/narrow-window.css)), so the spider moves
  right while a padding-derived offset stays at the edge. It drew a second, offset spider on a
  tablet, and was 2.8px out even with no growth at all.
- **The vertical budget is 8px and the margin is about half a pixel.** Measured in the bar rather
  than calculated, after three separate estimates of it (five pixels, then 1.8, then "an estimate")
  all turned out to be arithmetic from the keyframe's plateau that ignored the spring easing in
  front of it. The dock is 40px and clips; Abseil's drop overshoots to **8.78px** before settling,
  and at that peak the letter's box clears by **0.55px**. Dragline's clears by 0.60px. What clips is
  rendered pixels rather than boxes, so the visible ink has more room than that — but do not raise
  8px without measuring it in the bar again. `/design` cannot answer it: its cells clip a whole card
  rather than a 40px strip, and the coarse-pointer bar is 52px, a different question again.
- **A pseudo-element on a letter needs the letter to be positioned**, or `left: 100%` means 100% of
  the 136px anchor rather than of the 8px letter. Three animations hang one off a letter and all
  three were written without it; the base block now gives every letter `position: relative`, which
  is a line and retires the whole class.
- **`animation-fill-mode: both` makes the animation's last frame the resting value**, which is only
  safe if it is one. `spya-type` used it and left four letters permanently at `opacity: 0.3` under
  reduced motion. `backwards` fills the delay and then reverts to the base style, which cannot be
  wrong.

## What is deliberately not here

- **No SVG trace of the mark.** Several of the best ideas wanted one — a spider that draws itself in
  one unbroken stroke is the truest possible animation for a mark that really is one continuous
  strand. It needs a *centreline* trace rather than an autotraced outline (an outline gives you the
  line drawing its own border, which looks like a leak), plus a second copy of the mark to keep in
  sync. Worth doing one day; not worth it for a hover flourish.
- **No user setting.** There is one already, and it is the operating system's:
  `prefers-reduced-motion` collapses each of these to a **still** through the global guard in
  [`tailwind.css`](../../src/web/tailwind.css) — not to nothing, which is what a reader expects and
  is not what they get. The guard shortens durations and iteration counts; it does not touch delays
  and it does not touch fill modes, so what a reader is left with is the underlying style, or a
  `forwards` 100% frame, or a transitioned pose, depending on the animation. Most land on the base
  style; The Settle holds its lift, the seam stays parted with its thread drawn, the `i` stays a
  pixel high, and Radius Sweep sits as a two-tone spider. The stylesheet names the still each
  animation lands on, per animation, and that is the contract a fourteenth has to meet.
- **No weighting, no rarity, no context.** The wildcard list proposed animations that appear one time
  in fifty, that know the time of day, or that behave differently on a second hover. Some are good
  and they are all a second mechanism; the picker is uniform until something shows it should not be.
- **No sound.** Obviously.

## See also

- [design-css-overview.md](design-css-overview.md) — the parent: the stylesheets, the load order,
  which mechanism owns which rule
- [original-version/design-system.md](original-version/design-system.md) — the previous app's
  version of this feature, and the argument against it that this work is a deliberate exception to
- [reading-view-overview.md](reading-view-overview.md) — where the second copy of the wordmark lives
- [narrow-windows.md](narrow-windows.md) — why the word disappears
- [browser-testing.md](browser-testing.md) — **do not judge colour, or motion, from one screenshot**

Up: [design-css-overview.md](design-css-overview.md)
