# Brief: hover animations for the Spideryarn wordmark

The shared context handed to every idea-generating subagent on 2026-09-07, so the longlists
underneath ([260907f-logo-animations-longlist-*.md](.)) can be read without reconstructing what
each agent knew. Kept for posterity per Greg's instruction, *"Keep the workings for posterity."*

## What Greg asked for

> Let's have fun with the Spideryarn logo when you hover over it. … Whenever the user hovers or
> long-clicks the Spideryarn logo it should pick a random animation.
>
> — Greg, 2026-09-07

Two triggers, one behaviour: **hover** (mouse) and **long-press** (touch, which has no hover), each
picking a *random* animation from the set. Inspiration named explicitly: the previous version's
[`DESIGN_LOGO.md`](https://github.com/spideryarn/reading/blob/e2836c8b5c862e584f3cbe903ce77ba62637e5bc/docs/reference/DESIGN_LOGO.md)
and [`logo-animations.ts`](https://github.com/spideryarn/reading/blob/e2836c8b5c862e584f3cbe903ce77ba62637e5bc/lib/animations/logo-animations.ts).

## The mark itself

`public/spideryarn-logo.png` — 1203×1272, RGBA, drawn at **20×20 CSS px**. A **spider made of
yarn**: six legs radiating from a body that is a knot of overlapping loops, all one continuous
stroke weight, one flat colour (the brand orange `#DB8A45`), fully transparent elsewhere. There is
no second colour and no interior detail.

Three consequences an animation can exploit:

- **It is an alpha silhouette**, so `mask-image: url(/spideryarn-logo.png)` over any painted box
  gives complete control of its colour — a gradient sweeping *through* the spider, a two-tone
  split, a hue that shifts. `filter: hue-rotate()` and `drop-shadow()` work on it as-is.
- **It is radially symmetric-ish**: six legs from a centre. Rotation, per-leg motion (only via a
  redrawn SVG), and pulses radiating outward all read as "spider".
- **It has no SVG form today.** Tracing it into paths would unlock `stroke-dasharray` self-drawing
  and per-leg animation, and would cost a tracing pass plus a second copy of the mark to keep in
  sync. Propose it if an idea needs it; say so explicitly.

## The DOM, and the trap in it

The wordmark is drawn in **two places**, with **different inner markup**, and an animation must
work in both or say which it skips.

`HomeLogo` (src/web/HomeLogo.tsx) — fixed in the top-left corner of the shelf-adjacent pages:

```html
<a class="logo logo-home">
  <img class="logo-image" src="/spideryarn-logo.png" width="20" height="20" alt="">
  <span class="logo-text">
    <span class="logo-letter">S</span> … ×10
  </span>
</a>
```

`DockHome` (src/web/Dock.tsx) — the left-hand end of the reading view's bottom bar:

```html
<a class="logo dock-home">
  <img class="logo-image" src="/spideryarn-logo.png" width="20" height="20" alt="">
  <span class="dock-btn-label">          <!-- NOT .logo-text -->
    <span class="logo-letter">S</span> … ×10
  </span>
</a>
```

**The wrapper class differs on purpose** — `.logo-text` is hidden by a 731px media query, and the
dock's word is owned by the bar's own fit ladder instead (Dock.tsx § The word, and which mechanism
takes it away). So **select on `.logo-letter` and `.logo-image`, never on `.logo-text`**, and put
the animation class on `.logo`.

Ten letters: `S p i d e r y a r n`. Font 0.82rem, `--highlight` orange, `letter-spacing: 0.02em`.
The whole control is roughly 120×44 px. **Anything requiring more than ~44px of vertical room, or
that overflows into the page, will be clipped or will overlay real content** — the corner copy is
`position: fixed` at z-index 60, the dock copy sits inside a bar.

`.logo-letter` currently has no `display` set, so it is inline; an animation needing `transform`
must set `display: inline-block` itself.

## Two corrections, made after the longlists came back

Left as corrections rather than edited away, because the eight lists below were written against
the original text and a reader comparing the two should be able to see which claim they inherited.

**1. "Light and dark themes both" was wrong. There is only dark.** `styles/tokens.css:9` says so in
capitals — *"DARK ONLY, unconditionally — no toggle, no `prefers-color-scheme`, no light
fallback"*, and a repo-wide grep for `prefers-color-scheme` outside the motion guard finds nothing
(2026-09-07). The instruction that actually matters survives unharmed and is the one to keep:
**colours come from tokens, never from a hex**. What falls away is any idea that budgeted for a
second palette, and any that needed a colour to behave differently on a light ground —
`--highlight-ink` is the orange lifted *with white*, and it lifts because the page is dark.

**2. The two copies are not set in the same typeface**, which no doc said and which two agents found
independently. `styles/tokens.css:293` gives `.logo-text` — the corner copy only — `--font-brand`
(Trebuchet MS, not a variable font), `font-weight: 600`, and the orange. The dock copy's
`.dock-btn-label` gets none of that: it inherits `--font-ui` (Geist Variable) and takes its orange
from `.logo`. So **the same wordmark is Trebuchet 600 in the corner and Geist on the reading view**,
and the variable weight axis exists on only one of them.

That is a real inconsistency and not one this work introduced — Dock.tsx's own comment claims "same
glyph, same word, same colour", and it is right about all three things it lists and silent about the
fourth. It is left alone here deliberately: changing which face the reading view's wordmark is set
in is a visible design change Greg did not ask for. The consequence for this work is that **any
animation resting on the weight axis is dock-only**, and every other animation must be looked at in
both places rather than one.

## Constraints

- **CSS-first.** The previous version's 15 animations were pure CSS keyframes and that was the one
  thing about it worth copying. JS is allowed for *choosing* the animation and for anything CSS
  genuinely cannot express — not as a default.
- **The motion guard is already global** and flattens every animation to 0.01ms under
  `prefers-reduced-motion: reduce` (src/web/tailwind.css § the motion guard). You get that free;
  don't hand-roll a second one. But **an animation whose resting state is wrong** (a letter left
  rotated, a mask left half-swept) will freeze there, so every idea must be safe at one frame.
- **Light and dark themes both.** Colours come from tokens (`--highlight`, `--ink`, `--panel`,
  `--rule`); a hard-coded hex is a bug.
- **It must not move the layout.** The corner copy sits beside nothing, but the dock copy is in a
  flex row that reflows if the wordmark's box changes width. Use `transform`, `opacity`, `filter`,
  `mask`, `text-shadow`, `color` and absolutely-positioned pseudo-elements; avoid `margin`,
  `width`, `font-size`, `letter-spacing` on the live element.
- **A hover flourish, not a performance.** It runs while the pointer rests and stops when it
  leaves, so it should look right at 300ms and still look right after ten seconds of looping.

## What the previous version had (do not simply re-list these)

Fifteen animations: Highlight Sweep, Scanner Line, Elastic Stretch, Warm Glow Pulse, Silk Shimmer
Sweep, Strand Pulse, Web Threading, Entity Highlight, Glossary Builder, Document Parse, Format
Convert, Semantic Search, Letter Shuffle, Content Cascade, Granularity Shift.

They cost ~4,700 lines — a registry, a playground route and 1,911 lines of CSS — which
docs/project/original-version/design-system.md § The logo playground calls "the clearest example of
scope creep on a cosmetic feature in that repo". **The animations are the inspiration; the
apparatus is the warning.** A reference to one of these is fine if you are sharpening it into
something better, but a longlist that is fifteen renames is worthless.

## What to return

A numbered longlist. For **each** idea:

- **Name** — three words at most, evocative, no jargon.
- **What the reader sees** — two sentences, concrete, in visual language. Someone who has never
  seen it should be able to picture the motion.
- **Why it belongs to *this* product** — one sentence. What about Spideryarn does it say?
- **Mechanism** — the actual CSS/technology, specifically enough to implement: which selector,
  which property, which keyframes, any pseudo-element or extra markup needed.
- **Cost** — Easy (a dozen lines of CSS), Medium (30–60 lines, or a pseudo-element and staggered
  delays), Hard (new markup, an SVG trace, or JavaScript).
- **Risk** — the one thing most likely to make it look cheap, broken, or annoying.

Aim for **12–18 ideas**, ranging from the barely-there to the frankly silly. Do not
self-censor for taste at this stage; a later pass prioritises. Do not implement anything.
