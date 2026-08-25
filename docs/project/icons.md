# Icons

The reading view uses **[Lucide](https://lucide.dev)** (`lucide-react`), and only Lucide. This doc is
why that rather than Phosphor, what the house defaults are, and the two ways an icon swap breaks a
layout without anyone noticing.

## The decision

Chosen 2026-08-25. The obvious move was to reuse what the previous version used —
[original-version.md](original-version.md) records `docs/reference/DESIGN_ICONS.md` there as
*"Phosphor Icons provides comprehensive, consistent iconography across the entire application"*, and
carrying the same set across would have kept the two apps looking like siblings.

> we used an icon library there, but I forget which one. I'm tempted to use that same icon library
> for this project, unless you have a better recommendation.
>
> — Greg, 2026-08-25

There was a better one, and it came down to a single fact. Measured from the npm registry on
2026-08-25:

| package | weekly downloads | latest release |
|---|---|---|
| `lucide-react` | 96M | 1.34.0, **2026-08-24** |
| `react-icons` | 8.4M | 5.7.0, 2026-06-30 |
| `@heroicons/react` | 3.9M | 2.2.0, 2024-11-18 |
| `@phosphor-icons/react` | 3.3M | 2.1.10, **2025-05-22** |

Phosphor's *icon set* is alive and well. Its **React package had not shipped a release in fifteen
months** — no `next`, `beta` or `rc` dist-tag either, just `latest` sitting where it was in May 2025.

That is exactly the thing
[third-party-library-selection.md](../reusable/third-party-library-selection.md) puts first:

> **IMPORTANT** Long-lasting community, lots of docs/discussion/examples (so there will be lots of
> pretraining data to help LLM coding models).

Lucide has roughly thirty times the usage, is shadcn/ui's default icon set and so is saturated
through the React ecosystem, and shipped the day before we picked it. An agent writing against it
will get the API right without looking it up. Same reasoning as the tooltip choice in
[tooltips.md](tooltips.md) and the test-runner choice in [testing.md](testing.md).

Two smaller points fell the same way:

- **The Vite dev server.** `@phosphor-icons/react` is one barrel over ~9,000 icons × 6 weights; the
  previous version needed `optimizePackageImports` in `next.config.ts` to survive it. Lucide ships
  one module per icon and tree-shakes with no config, which matters here because
  [architecture.md](architecture.md) is deliberately one Vite process and no build cleverness.
- **Stroke weight is a dial, not a menu.** `strokeWidth={1.75}` lets the chrome recede against the
  dark ground. Phosphor's answer is six discrete weights.

**The shadcn half of that reasoning paid off within the day.** Lucide was picked partly for being
shadcn/ui's default set, at a point when we had no shadcn and no plan to get any. When components
arrived on 2026-08-25 ([web-client.md § Tailwind and shadcn](web-client.md#tailwind-and-shadcn-components)),
there was no icon work at all: `"iconLibrary": "lucide"` in [`components.json`](../../components.json),
generated components import from `lucide-react`, and they inherit the house defaults from the
existing `<LucideProvider>` in [`src/web/main.tsx`](../../src/web/main.tsx) for free. Had we carried
Phosphor across, every generated component would have arrived with a second icon convention in it.

**What we gave up, and it's real:** Phosphor has ~9,000 icons to Lucide's ~1,600, and a genuine
`fill` weight, which is the cleanest way to show a binary state (filled bookmark = saved). If a lot
of stateful toggles arrive and outline-only starts to feel mushy, that is the reason to revisit.

### The road not taken: no library at all

Worth recording, because it was close. When this was decided the whole client had exactly two icons —
a `×` and a `▾`, both plain Unicode characters — and pasting a handful of inline SVGs from lucide.dev
would have cost nothing and added no dependency. We took the dependency because the icons that are
obviously coming (spine controls, zoom affordances, comment chrome) would have turned that into a
private, undocumented icon set, which is the thing "single icon library" exists to prevent.

## House defaults

Set once, in [`src/web/main.tsx`](../../src/web/main.tsx), via Lucide's own context provider:

```tsx
<LucideProvider size={16} strokeWidth={1.75}>
```

16px against the 0.82rem UI face, and a stroke thinner than Lucide's default of 2 because at 2 on the
dark ground the icons read as bold and start competing with the prose. They are chrome; the article
is the thing.

Per-icon `size` overrides are fine for a specific fit (the masthead chevron is 14, the search globe
is 12) — **weight overrides are not**, because a single icon at a different stroke is the one that
looks wrong.

## Rules

- **One library.** No second icon set, no stray inline SVG that duplicates something Lucide has.
  There was a hand-rolled globe in `CommentDialog.tsx`; it's gone. Composing an extra path *into* a
  Lucide icon is fine when there's a reason (see the next rule); drawing a whole icon from scratch
  is not.
- **Colour comes from `currentColor`**, so state is a CSS colour change on the parent and never a
  prop. See `.cmt-search.on` / `.cmt-search.off` in
  [`src/web/styles.css`](../../src/web/styles.css).
- **Reach for a named `-off` variant first, but check it at the size you'll use it.** Lucide has
  `GlobeOff`, `EyeOff`, `WifiOff` and so on. The `-off` icons are drawn for 24px: they knock the
  base icon into arc *fragments* around the slash, and below roughly 16px those fragments smear into
  a grey blob. The search badge in `CommentDialog.tsx` is 13px, so it composes instead — a whole
  `Globe` with one clean diagonal child. Two things that took a look at 8× magnification to see:
  the diagonal **must run past the circle at both ends** (`M2.5 21.5 21.5 2.5`), because one that
  stops inside reads as another line *of* the globe rather than a line through it, and composing
  children triggers the `aria-hidden` trap below.
- **Unicode is still right for text.** The `›` in a spine breadcrumb, the `§` marking an author's own
  heading, the `↑↓` in the keyboard hint ([keyboard.md](keyboard.md)) — those are characters in a
  sentence, not icons, and swapping them for SVG would be a downgrade.

## The loading spinner

There is one, it is an icon like any other, and it is
[`LoaderCircle`](https://lucide.dev/icons/loader-circle) turned by a CSS keyframe:

```tsx
<LoaderCircle className="cmt-spinner" size={13} />
```

```css
.cmt-spinner {
  flex: none;
  color: var(--highlight);
  animation: cmt-spin 0.7s linear infinite;
}
@keyframes cmt-spin { to { transform: rotate(360deg); } }
```

That is the whole thing. Notes, in the order they'll bite:

- **`LoaderCircle`, not `Loader`.** `Loader` is the twelve-spoke dial, which wants a *stepped*
  animation (`steps(12)`) to look right and turns into a grey asterisk below ~16px. `LoaderCircle`
  is a single open arc — one path, spins smoothly, still legible at 10px, which is the size the
  "3 still working" badge uses.
- **Size at the call site, never in the CSS.** `size` is a prop; the class carries only colour and
  motion. The old spinner here was a bordered `<div>` and needed a `.cmt-spinner-sm` variant to
  restate width, height *and* border-width together — three values that had to stay in proportion by
  hand. There is nothing to keep in sync now.
- **0.7s linear.** Slower reads as stuck, faster reads as panic, and any easing on a full rotation
  makes it look like it's stumbling.
- **Not Tailwind's `animate-spin`**, which is what Lucide's own docs use and is available here now
  that Tailwind is in. Two reasons: it is 1s, which is a beat too slow for a spinner this small, and
  it has no reduced-motion behaviour — it keeps spinning, or you reach for `motion-safe:` and get a
  spinner that *freezes*, which is the one outcome the next section says to avoid. A four-line
  keyframe buys the right speed and the right fallback together.
- **Colour is `currentColor`**, so `color: var(--highlight)` on the class is the whole of its
  styling. Don't pass `color` as a prop.
- **`aria-hidden` comes for free** — Lucide adds it to any icon with no children (see below), and
  the spinner always sits next to real text saying what is happening. That text is the accessible
  announcement; the spinner is decoration. Never ship a spinner with no words next to it.

### Reduced motion

Non-negotiable, and the interesting half is that **it must not simply stop**:

```css
/* A spinner that cannot spin still has to say "working", so it pulses instead
   of freezing into what looks like a rendering artefact. */
@media (prefers-reduced-motion: reduce) {
  .cmt-spinner { animation: cmt-pulse 1.4s ease-in-out infinite; }
  @keyframes cmt-pulse { 50% { opacity: 0.25; } }
}
```

A frozen `LoaderCircle` is a broken circle sitting next to some text — it reads as a glitch, not as
patience. Swap the animation, don't remove it. The tooltips do the same thing for the same reason
([tooltips.md](tooltips.md)), and the rule for the whole client is in
[`src/web/styles.css`](../../src/web/styles.css): anything that moves needs an answer for someone who
has asked for less movement.

### Checking it actually spins

A hidden tab does not run animations. `getAnimations()[0].playState` still says `"running"` and
`animationName` still says `cmt-spin`, but `currentTime` stays at 0 and the computed `transform`
stays at the identity matrix forever — which looks exactly like a spinner you have broken. That is
the same class of lie as the scroll events in
[browser-testing.md](browser-testing.md#a-background-tab-will-lie-to-you-about-scrolling): check `document.hidden` before you
believe anything. To test one without bringing the tab to the front, drive the clock by hand and
read the matrix off:

```js
const a = svg.getAnimations()[0];
a.currentTime = 175;                       // a quarter of 0.7s
getComputedStyle(svg).transform;           // → matrix(0, 1, -1, 0, 0, 0), i.e. 90°
```

The worked example is `.cmt-spinner` in [`src/web/styles.css`](../../src/web/styles.css), used twice
in [`src/web/CommentDialog.tsx`](../../src/web/CommentDialog.tsx) — once at 13px while an
explanation is being written, once at 10px in the footer counting the ones still in flight
([comments.md](comments.md)).

## Two things that break quietly

Both are instances of the pattern in
[silent-success.md](../reusable/silent-success.md) — the change reports success and the obvious check
agrees with it.

1. **Centring that depended on `font-size` and `line-height`.** A glyph in a button is text: it sits
   on the baseline, and `line-height: 1` with a fixed width is enough to centre it. An SVG is a
   replaced inline element sitting *on* that baseline, so it lands one or two pixels low — close
   enough to look fine in a screenshot and wrong to the eye. Every button that took an icon here had
   to become `display: inline-flex; align-items: center`, and its `font-size` had to go, because a
   `font-size` on an SVG parent does nothing and reads as if it still controls the size.
2. **`aria-hidden` disappears the moment you pass children.** Lucide adds `aria-hidden="true"`
   automatically — *unless* the component has children or you passed an a11y prop
   (`node_modules/lucide-react/dist/esm/Icon.mjs`). So `<Globe><path …/></Globe>` silently becomes an
   announced, unlabelled graphic. The icons here are all decorative, sitting inside a button that
   carries its own `aria-label`; if you ever do compose children in, put `aria-hidden="true"` back by
   hand.

## Where they're used

- [`src/web/Masthead.tsx`](../../src/web/Masthead.tsx) — `ChevronDown`, rotated by `.chevron.up` for
  the article-details disclosure.
- [`src/web/CommentDialog.tsx`](../../src/web/CommentDialog.tsx) — `X` to close, `ChevronLeft` /
  `ChevronRight` to step between comments, and `Globe` — struck through by a composed diagonal when
  the model didn't search — for whether it went to the web ([comments.md](comments.md)).

## See also

- [web-client.md](web-client.md) — the reading view these live in, and its constraints
- [tooltips.md](tooltips.md) — the other third-party UI dependency, chosen the same way
- [original-version.md](original-version.md) — Phosphor there, and the rest of what we did and didn't lift
- [../reusable/third-party-library-selection.md](../reusable/third-party-library-selection.md) — the process this followed
- [../reusable/silent-success.md](../reusable/silent-success.md) — the pattern behind both failure modes above
