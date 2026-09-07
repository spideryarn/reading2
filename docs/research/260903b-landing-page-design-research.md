# Landing page design: what to add (nothing), and what to copy

> **Status.** Research, 2026-09-03, for making `/` and `/features` look substantially more
> attractive without framework churn. Followed
> [third-party-library-selection.md](../reusable/third-party-library-selection.md). Not yet linked
> from any entry-point doc — the requester will do that.

## Recommendation

**Add no new npm dependency.** Every candidate either isn't a package (it's copy-paste markup or a
one-time design purchase) or has a free CSS-only equivalent that's a better fit for two static
pages:

| Candidate | Verdict | Why |
|---|---|---|
| shadcn/ui official blocks (`ui.shadcn.com/blocks`) | Skip | Free, MIT, Tailwind-v4-era, but the catalogue is dashboards/auth/sidebars — no marketing hero/feature blocks today |
| shadcnblocks.com (marketing blocks) | Skip as a dependency; optional as a **reference** | Paid ($79–299 one-time), copy-paste code not an install — a design-time purchase decision, not an engineering one |
| Tailwind Plus (was Tailwind UI) | Skip as a dependency; optional as a **reference** | $299 one-time for markup patterns only — our tokens/palette are already custom, so it buys structure, not CSS |
| `motion` (Framer Motion) | Skip | 45.6KB gzip full bundle for two pages of entrance animation is disproportionate; React 19-compatible and thriving (20M dl/wk) but the wrong tool here |
| `react-intersection-observer` | Skip unless pre-Safari-26 support matters | 1.5KB gzip, real option, but native CSS covers Chrome/Edge/Safari already |
| Native CSS `animation-timeline: view()` | **Use, CSS-only** | 86% global support (Chrome/Edge 115+, Safari 26+); Firefox hasn't shipped it, so ship content visible-by-default and layer the animation behind `@supports` |
| Mesh-gradient/noise library | Skip | No established maintained package; free generators (MagicPattern, CSSmatic) produce static CSS/SVG to paste in once |

This is the "prefer boring" tiebreak in
[vision.md § Prefer boring](../project/vision.md#prefer-boring) working as intended — no third
framework exception is warranted. Everything below is CSS/Tailwind utilities plus restructuring the
existing JSX.

## Evidence

### 1. Dependencies

- **`motion`**: 19,993,421 downloads/week, `13.2.0` published 2026-09-02, MIT, `peerDependencies`
  cover React 19. Full bundle 136KB min / **45.6KB gzip** (bundlephobia); tree-shaken
  `LazyMotion` variant ~5–18KB per [motion.dev's own bundle-size
  guide](https://motion.dev/docs/react-reduce-bundle-size). `framer-motion` is now a
  compatibility alias of the same release, not a separate maintained package.
- **`react-intersection-observer`**: 5,018,339 downloads/week, `11.0.1` published 2026-08-26, MIT,
  ~1.5KB gzip. Only worth it if Firefox parity for scroll-reveal specifically matters — see below.
- **`animation-timeline: view()`**: [caniuse](https://caniuse.com/mdn-css_properties_animation-timeline_view)
  puts global support at 86.09% as of today. Chrome/Edge 115+ and Safari 26+ ship it; **Firefox
  does not** (Nightly only, Interop-2026 tracked, expected around Firefox 158). The safe pattern is
  "visible by default, animated as enhancement" — see [Techniques § 3](#3-scroll-reveal-css-only-with-a-firefox-fallback).
- **shadcn/ui blocks**: official registry is free and MIT but is dashboard/auth-shaped, not
  marketing-shaped, as of this check. `shadcnblocks.com` is a real, current third-party registry
  (2,018 blocks, explicit Tailwind v4 support) at $79–299 one-time — a legitimate thing for Greg to
  buy as a *markup reference* if he wants to move faster, but it installs by copy-paste, not `npm
  install`, so it doesn't touch the "prefer boring" dependency question at all.
- **Tailwind Plus**: $299 personal / $979 team, one-time, lifetime updates, 500+ components
  including marketing sections. Same shape as shadcnblocks — worth it only as a source of HTML
  structure, since the token/palette work here is already done and is bespoke
  ([design-css-overview.md](../project/design-css-overview.md)).
- **Mesh-gradient/noise**: no actively-maintained npm package found. The live options are
  browser-based *generators* (MagicPattern, MeshSVG, CSSmatic) that output a static gradient or
  data-URI once, which is exactly what [Techniques § 1](#1-a-single-hero-glow-reserved-for-one-moment) and
  [§ 4](#4-grid-or-grain-texture-use-sparingly) do.

### 2. What 2026 dark dev-tool landing pages actually do

Surveyed Linear, Raycast, Notion, Vercel, Cursor, and — closer to our own brand — Matter (a
restraint-branded reading product). Anthropic, Obsidian, Arc, Readwise, Instapaper, Perplexity
either returned no usable content or weren't in reach; the pattern below is consistent enough
across the six that were fetched to be load-bearing anyway.

- **Marketing type is 3–5× reading type, not a scaled-up version of it.** Hero H1s cluster
  48–80px (Vercel 48, Raycast 64, Cursor 72, Linear 80) against a uniform 16px body — a much bigger
  jump than our current `text-5xl`/`text-2xl` pairing on a page that also carries `text-[0.95rem]`
  body copy throughout.
- **Depth comes from a surface-color ladder and hairline borders, not drop shadows or glow.**
  Linear, Raycast, Vercel and Cursor all layer near-black surfaces a few percent apart
  (Raycast: `#07080a` → `#0d0d0d` → `#101111` → `#121212`) with 1px borders at low opacity
  (`#23252a`, `#242728`, `white/8–10%`) and 12–16px radii. Drop shadows are largely absent; where
  Vercel uses one it's multiple near-transparent layers under 10% black, no colour tint.
- **Gradient/glow is a hero-only move, used once, not per-screenshot.** Raycast's red stripe and
  Vercel's mesh gradient both appear exactly once, at the top of the page — not repeated behind
  every shot. That matches [Techniques § 1](#1-a-single-hero-glow-reserved-for-one-moment) below.
- **Explanatory sections are wide (1200–1440px) with alternating two-column text+image**, not a
  narrow single reading column. Vertical rhythm between sections is ~64–96px. This is the strongest
  argument against our current unbroken `max-w-3xl` — see [§ What to actually
  change](#what-to-actually-change-given-the-brand).
- **No noise/grain texture on any of these live sites today** — it reads as a 2024-era trend rather
  than current practice. Worth knowing before reaching for [Techniques § 4](#4-grid-or-grain-texture-use-sparingly).
- **Matter — the one restraint-branded product surveyed — goes further than "toned down".** Short
  headline, horizontal divider lines instead of cards or shadows, no gradients, no animation,
  screenshots shown plainly rather than hero-glorified. That's the closer analogue to Spideryarn's
  own brand than Linear/Raycast/Vercel's "hero-moment gradient + surface ladder", which is built for
  a punchier, more sales-driven pitch.

### What to actually change, given the brand

Spideryarn's own copy says the product is "a companion, not a replacement" and the vision doc's
anti-goals rule out anything that reads as hype. The read-through of the evidence above, for this
brand specifically:

- **Keep prose narrow, let the page shell go wider.** The 65ch-ish measure in
  `LandingPage.tsx`/`FeaturesPage.tsx` is right for the *paragraphs* — it's the same number
  [typography.md](../project/typography.md) already
  settled on for the reading column. What's worth widening is the outer container and the
  screenshot treatment: let a `Shot` sit beside its caption in a two-column row on wide screens
  (image ~55%, text ~45%, alternating sides down the page) rather than every shot stacked full-width
  above a caption. That's the Notion/Vercel structural move, without adopting their type scale or
  gradient wash.
- **One hero glow, not one per screenshot.** Reserve [Techniques § 1](#1-a-single-hero-glow-reserved-for-one-moment)
  for the lead glossary shot only, matching what every surveyed site actually does.
- **Adopt the surface-ladder + hairline-border depth language**, which is already partly present
  (`tw:border tw:border-border tw:bg-card/50` on the sign-in sections) — extend it rather than
  reaching for shadows or a repeated glow.
- **Grow the hero type**, `text-5xl`→something closer to 64–72px for `h1`, since 3–5× the 0.95rem
  body is what every surveyed site does and ours currently isn't close.
- **Skip grain/noise and skip tilt/3D perspective** — neither appears live on any comparable product
  today, and both would read as decoration on a page whose own copy argues against "trying to make
  things too easy" (vision.md).

## Techniques

Copy-pasteable, no new dependency. Written as plain CSS; adapt literal values to `tw:` arbitrary
utilities per [design-css-overview.md](../project/design-css-overview.md) — chrome-level, one-off
adjustments are Tailwind's job, and anything reused across sections should be a semantic class in
`src/web/styles/site.css` rather than a repeated utility string, per that doc's rule of thumb.

### 1. A single hero glow, reserved for one moment

```css
.hero-glow {
  position: absolute;
  inset: -20% -10% auto -10%;
  height: 60%;
  background: radial-gradient(circle at 50% 30%, #DB8A45 0%, rgb(219 138 69 / 0.35) 35%, transparent 70%);
  filter: blur(80px);
  mix-blend-mode: screen;
  pointer-events: none;
}
.hero-shot { position: relative; z-index: 1; }
```

Use it exactly once, behind the lead glossary shot. Mixed in `oklab`/plain `rgb()` rather than
`oklch`, per the trap already documented in
[design-css-overview.md § Colour](../project/design-css-overview.md#colour-one-source-dark-only).

### 2. A bordered "app window" frame, no extra markup

```css
.window {
  border-radius: 12px;
  border: 1px solid rgb(255 255 255 / 0.08);
  box-shadow: 0 20px 60px -20px rgb(0 0 0 / 0.6);
  overflow: hidden;
}
.window-bar {
  height: 36px;
  display: flex;
  align-items: center;
  padding: 0 12px;
  background: var(--panel);
  border-bottom: 1px solid rgb(255 255 255 / 0.06);
}
.window-bar::before {
  content: "";
  width: 10px; height: 10px; border-radius: 50%;
  background: #febc2e;
  box-shadow: 18px 0 #28c840, 36px 0 #ff5f57; /* two more dots, no extra DOM */
}
```

Whether this is worth adding at all is a product call, not just a CSS one — the surveyed sites that
skip drop shadows (Linear, Raycast, Cursor) mostly skip the browser-chrome frame too, showing the
screenshot as a plain bordered panel instead. The simpler version (border + radius, no `window-bar`)
matches what's actually current.

### 3. Scroll-reveal, CSS-only, with a Firefox fallback

Author the finished state as the default rule so an unsupported browser (Firefox, today) just shows
static content — never invisible, never broken:

```css
.reveal { opacity: 1; transform: none; }

@supports (animation-timeline: view()) {
  .reveal {
    opacity: 0;
    transform: translateY(24px);
    animation: fade-in linear both;
    animation-timeline: view();
    animation-range: entry 0% cover 30%;
  }
  @keyframes fade-in { to { opacity: 1; transform: none; } }
}
```

Given the section rhythm already recommended above (fewer, wider sections rather than many small
stacked blocks) there may not be much to reveal — worth judging after the layout pass, not before.
The global `prefers-reduced-motion` guard in `tailwind.css` (design-css-overview.md's motion
section) already covers new `animation` rules the same way it covers everything else.

### 4. Grid or grain texture — use sparingly

```css
/* faint grid */
.grid-bg {
  background-image:
    repeating-linear-gradient(0deg, rgb(255 255 255 / 0.04) 0 1px, transparent 1px 48px),
    repeating-linear-gradient(90deg, rgb(255 255 255 / 0.04) 0 1px, transparent 1px 48px);
}
```

```css
/* SVG feTurbulence noise, no image request */
.grain::after {
  content: "";
  position: absolute; inset: 0;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 250 250'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.8' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  opacity: 0.06;
  mix-blend-mode: overlay;
  pointer-events: none;
}
```

Given §2's finding that no surveyed live site currently carries this, treat both as optional and
low-priority rather than default.

### 5. Bento grid for the feature list

```css
.bento {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  grid-auto-rows: 160px;
  gap: 16px;
}
.bento .featured { grid-column: span 2; grid-row: span 2; }
.bento .wide { grid-column: span 2; }
```

A candidate for the "And the rest of it" `<Feature>` list on `LandingPage.tsx`, which is currently a
plain stacked `<ul>`.

### 6. Sticky nav (lower priority)

Plain `position: sticky; top: 0` needs no JS as long as no ancestor clips overflow — worth checking
against the existing stylesheet before adding one, per the general sticky-positioning trap in
[css-sticky-containing-block.md](../reusable/css-sticky-containing-block.md).

## Sources

- shadcn/ui blocks: https://ui.shadcn.com/blocks
- shadcnblocks.com: https://www.shadcnblocks.com/ and https://www.shadcnblocks.com/pages/landing-page
- Tailwind Plus: https://tailwindcss.com/blog/tailwind-plus and https://tailwindcss.com/plus
- `motion` on npm: https://www.npmjs.com/package/motion — bundle size: https://motion.dev/docs/react-reduce-bundle-size
- `framer-motion` on npm: https://www.npmjs.com/package/framer-motion
- `react-intersection-observer` on npm: https://www.npmjs.com/package/react-intersection-observer
- `animation-timeline: view()` support: https://caniuse.com/mdn-css_properties_animation-timeline_view and https://developer.mozilla.org/en-US/docs/Web/CSS/animation-timeline
- Scroll-driven animations explainer: https://www.joshwcomeau.com/animation/scroll-driven-animations/
- Mesh-gradient generators: https://www.magicpattern.design/mesh-gradients, https://meshsvg.com/, https://www.cssmatic.com/gen-noise-texture.html
- CSS browser-frame mockups: https://codepen.io/adrienjarthon/pen/ogjjoj, https://codepen.io/didoesdigital/pen/NYEezJ
- Grain/noise techniques: https://ibelick.com/blog/create-grainy-backgrounds-with-css, https://www.freecodecamp.org/news/grainy-css-backgrounds-using-svg-filters/
- Bento grid: https://speckyboy.com/css-bento-grid-layouts/, https://iamsteve.me/blog/bento-layout-css-grid
- Site surveys: https://linear.app, https://raycast.com, https://www.notion.com, https://vercel.com,
  https://cursor.com, https://www.getmatter.com, and the design-token teardowns at
  https://github.com/VoltAgent/awesome-design-md (linear.app, raycast, vercel, cursor entries)
