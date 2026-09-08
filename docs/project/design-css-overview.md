# Design and CSS: an overview

**This is the map, and it is deliberately short.** It exists to answer one question —
*where does a style live, and which mechanism owns it?* — because the answer is spread across four
stylesheets and several other docs, and every new agent has to reconstruct it. What is written
below is true and checked. What is missing is listed at the bottom, honestly, rather than left for
you to discover.

It was one 660-line document until 2026-09-07, which is a map with three essays stapled to it. The
essays are [under this doc](#under-this-doc) now, one per area, moved verbatim.

Nothing here restates [web-client.md](web-client.md), [icons.md](icons.md) or
[tooltips.md](tooltips.md). This is the map; those are the territory.

## The stylesheets, in load order

`main.tsx` imports **one** stylesheet, and it is not the one you would guess.

| # | File | What it holds |
|---|---|---|
| 1 | [`src/web/tailwind.css`](../../src/web/tailwind.css) | **the entry point.** The `@layer` statement, the Tailwind imports, the token bridge, the source-scanning rule |
| 2 | `tailwindcss/theme.css` + `utilities.css` | Tailwind v4, prefixed `tw`, in layers `theme` and `utilities`. **Preflight is deliberately not imported** |
| 3 | [`src/web/styles.css`](../../src/web/styles.css) | **nothing but `@import`s.** Imported by *file 1* so everything below it lands in `@layer app`, and it is the authoritative statement of the order the hand-written CSS loads in. A **new sheet takes two edits**: the `@import`, at the position you want it in the cascade, and the same name at the same position in `MANIFEST` in [`tests/styles-entry-is-imports-only.test.ts`](../../tests/styles-entry-is-imports-only.test.ts), which is the independent witness to that order |
| 3a | [`src/web/styles/`](../../src/web/styles/) | every hand-written rule, one file per area, imported by *file 3*. Three positions in that order are load-bearing: [`tokens.css`](../../src/web/styles/tokens.css) first, because everything below reads its semantic names; [`narrow-window.css`](../../src/web/styles/narrow-window.css) near the end, because nearly every phone rule wins by being later rather than by specificity — its own header says so; and [`site.css`](../../src/web/styles/site.css) last. Read `styles.css` for the rest of the order rather than guessing it from the file names |
| 4 | [`styles/tokens.css`](../../styles/tokens.css) | the brand palette and the four font stacks, imported in turn by *file 3* |
| 5 | [`styles/colourscales.css`](../../styles/colourscales.css) | the three palettes that are **not** the brand — categorical, sequential, diverging — imported by *file 4*. See [colour-scales.md](colour-scales.md) |

`wc -l src/web/styles.css src/web/styles/*.css` on 2026-09-06: 65 lines of `@import` over 37 files,
15,951 lines in all.

The nesting is the load-bearing part. Importing `styles.css` from `main.tsx` alongside
`tailwind.css` **does not work** — it lands unlayered, outranks every utility, and Tailwind
silently does nothing. The full reasoning is in the header comment of
[`tailwind.css`](../../src/web/tailwind.css) and in
[web-client.md § Four guards](web-client.md#four-guards-all-in-tailwindcss).

## Which mechanism owns what

Three mechanisms can style the same element, and picking wrongly is how the cascade fights get
started. The rule of thumb:

- **`src/web/styles/`** owns anything structural, anything that reads as a *system* — the table
  geometry, the spine, the tooltip card, the reading typography — each scoped to a class it
  owns. A bare `thead th` is not table geometry, it is every table in the app
  ([postmortem](../postmortems/260906g-an-unscoped-element-selector-in-styles-css-reached-every-table-in-the-app.md)).
  Semantic class names
  (`.spine`, `.gist`, `.prose`) are the interface; [web-client.md § Never delete a semantic class
  name](web-client.md#never-delete-a-semantic-class-name) says why they must not be replaced by
  utility soup even where they carry no rules.
- **Tailwind utilities**, written `tw:flex`, `tw:hover:bg-accent` — v4 colon syntax, not the v3
  dash — own one-off adjustments inside components, mostly where a shadcn component needs
  nudging.
- **shadcn components** in [`src/web/components/ui/`](../../src/web/components/ui/) own
  `button` and `toggle`, and nothing else. What is staying hand-written, and why,
  is in [web-client.md § Tailwind and shadcn](web-client.md#tailwind-and-shadcn-components).

  **A worked example of that boundary, 2026-08-26.** Every "run this job" button moved to shadcn's
  `Button`, via [`JobProgress.tsx`](../../src/web/JobProgress.tsx). Not because shadcn is better,
  but because there were three copies of one component and two of them carried their own
  hand-written rules — `gloss-btn` and `summ-btn`, identical apart from two paddings, a gap and two
  colours. A button that appears in three panels is a *system*, which by the first bullet would put
  it in `src/web/styles/`; but it is also chrome, which the third bullet puts in shadcn. Chrome won,
  because the alternative was inventing a third set of numbers for something the thread page was
  already drawing correctly. 38 lines of CSS went.

The longer version, with the bugs that made each boundary necessary, is
[260825a-shadcn-migration.md § Which mechanism does what](../plans/260825a-shadcn-migration.md#which-mechanism-does-what).

## Colour: one source, dark only

[`styles/tokens.css`](../../styles/tokens.css) is the single source of truth. Two things follow
from that, and both bite:

- **Dark only, unconditionally.** No toggle, no `prefers-color-scheme`, no light fallback —
  Greg's call, 2026-08-24. [web-client.md § Dark mode](web-client.md#dark-mode) has the quote and
  what to do if light mode ever comes back.
- **`--accent` is a raised dark *surface*, not the orange.** That is shadcn's meaning of the name,
  and shadcn's own components walk straight into it. Anything meaning the brand orange says
  `--highlight`. See the token block in
  [`src/web/styles/tokens.css`](../../src/web/styles/tokens.css), and
  [260825a-shadcn-migration.md § Trap A](../plans/260825a-shadcn-migration.md#the-token-bridge).

The semantic layer in [`src/web/styles/tokens.css`](../../src/web/styles/tokens.css)
(`--ink`, `--page`, `--panel`, `--surface-raised`, `--rule`) sits over the brand tokens so the
rules below read in reading-view terms rather than in shadcn surface names. On a dark ground the greys run the other way: *soft* and *faint* are darker,
not lighter.

### Both of those are checked, because both had already happened

[`tests/css-tokens.test.ts`](../../tests/css-tokens.test.ts) reads all four stylesheets and asserts
two things. Neither was a hypothetical; `§ outline mode` had six instances of the second and three
of the first, and the panel was half unreadable on screen for four days before Greg's screenshot.

- **A `var(--x)` with no fallback names a token that exists** — in one of the four sheets, or set as
  an inline style from `src/web` (the test reads those too, including the `--h${i}` family
  `annotate.ts` emits). An undefined custom property with no fallback is *invalid at computed value
  time*: the whole declaration is dropped and the property inherits. Nothing errors, and the rule
  looks exactly like one that was applied. `.outln-row.here { color: var(--fg) }` — the mark on the
  reader's whole ancestor chain — did nothing at all.
- **No `color:` is a surface token.** `--muted` is `oklch(0.245 0 0)` and the page is
  `oklch(0.145 0 0)`, so text painted in it sits at about 1.2:1. The text twin is
  `--muted-foreground`, aliased here as `--ink-faint`.

A third checks the same mistake in Tailwind's spelling: `tw:text-muted` is not the text colour —
the bridge at the top of `tailwind.css` maps `--color-muted` to `--muted`, the surface — and
`tw:text-muted-foreground` is. All 88 call sites in `src/web` are already the right one, so that
check arrives with a clean baseline, which is the only time one is cheap to add.

### And the other direction: a utility nothing generates

[`tests/tailwind-utilities-resolve.test.ts`](../../tests/tailwind-utilities-resolve.test.ts) is the
complement. `css-tokens` catches a *stylesheet* reading a token nothing defines; this catches a
*component* writing a `tw:` class nothing compiles — **a Tailwind v4 utility whose theme key is
missing emits no rule at all**, so the class stays on the element, the build succeeds, and the
property falls back to its own default: text inherits, a background goes transparent, a border
colour becomes `currentColor`. Every one of those looks designed rather than broken. Four names were
missing from the bridge for weeks and twenty utilities were dead, including the whole visual
treatment of `SharedNotice`
([260905f](../plans/260905f-twenty-tailwind-utilities-that-compiled-to-nothing.md)).

Every input comes from Tailwind itself — its `compile()` over the real `tailwind.css`, its own
scanner over the `@source` that file names, its resolver per candidate — because the alternative is
a hand-written model of which utilities are colours, and `text-sm`, `border-t`, `divide-y` and
`bg-transparent` all disprove it. **A test that has to be taught the answer can be taught the wrong
one**, which is how the bug got in.

Adding a theme key is not free: **`--color-x` enables every colour-shaped utility, not the one you
wanted**. `--color-rule` makes `tw:text-rule` legal, and that is words in a hairline colour. The
`tw:text-` half of `css-tokens.test.ts` is what stops it, so a new name in the bridge means checking
that guard covers it.

**The file's header says what it does not prove**, and that matters more than the list above.
It is a text scanner: it cannot see scope or reachability, cannot see what is actually behind the
text, and cannot judge a fallback that is present and still wrong. Each half also asserts it can
still *find* the shape it filters, because a regex that has stopped matching anything is
indistinguishable from a codebase with nothing wrong in it.

The `--accent` warning above was already written in two files, in capitals, and the mistake was made
anyway with `--accent`'s neighbour. **A rule that is only written down is not a check**, which is
why these now are.

**There is exactly one colour that is not the orange, and it is `--hit-rgb`** — the wash over search
results ([search.md](search.md)). It exists because a comment, a glossary term and a search hit can
all cover the same sentence, and three meanings separated only by opacity is one hue too few. That
is not a guess: the version this project is an offshoot of drew all three in `#DB8A45` and got away
with it only because it could never show two at once
([original-version/highlighting.md](original-version/highlighting.md)). On a near-black ground the
failure is worse than muddled, it is invisible.

It is held as **three space-separated numbers rather than as a colour**, because the confidence wash
is `rgb(var(--hit-rgb) / <alpha>)` and that form is the one that takes a variable alpha. `--hit` is
the ordinary-colour alias beside it. Anything else that needs a second meaning on the prose should
add a token here rather than reach for another alpha of the orange.

**Since 2026-08-26 that sentence needs a second half.** Several saved searches can be showing at
once, each in its own hue, so the search mark had to split into two channels: a low-chroma slate
wash (`--hit-wash-rgb`) carrying the model's confidence, and one coloured rule per search underneath
it carrying *which* search. `--hit-rgb` is now the panel's chrome colour rather than the wash's. The
eight hues are in [`colourscales.css`](../../styles/colourscales.css) and the reasoning is in
[colour-scales.md](colour-scales.md) — including the two things that make a published palette wrong
on this page, and the fact that slot 6 sits close enough to the brand orange to be worth knowing
about.

**And a third half since 2026-09-07, which adds a token rather than a hue.** Quotes are drawn in the
prose as an *outline* — `--quote-stroke-rgb`, with `--quote-stroke-color` the alias beside it — and
the width of that outline carries the quote's priority. The reason it is not another wash is that
every channel a `<mark>` has was already spoken for: the fill says how confident a search is, the
hue underneath says *which* search found it, and a fourth alpha of the slate would have been a
second way of saying "somebody marked this". **Search hits fill; quotes outline.** If a future
change needs a fill for quotes after all, the reason this was chosen has gone. The mechanism, the
two tiers and what is still open — including the fact that this green is the same family as
`--cat-2` rather than the unused hue it was first claimed to be — are in
[quotes.md § The stroke](quotes.md#the-stroke-which-is-how-a-quote-says-how-much-it-matters) and
[260907c](../plans/260907c-quotes-drawn-as-a-stroke-in-the-prose-with-weight-carrying-priority.md).

One trap worth repeating here because it is invisible: **mix colours in `oklab`, not `oklch`.**
`--page` is written `oklch(0.145 0 0)`, a hue explicitly specified as 0 rather than missing, so
polar interpolation drags a mix round to 11.7° and the result is quietly pink instead of warm.
`--highlight-wash` escapes only by using `in oklab`.

## The stacking order, which is real even though it is not a scale

**Do not read a number off this list and reuse it.** The values are not a scale and were not
designed; what is load-bearing is the *order*, and only in a few places where one thing has to clear
another. Those places, with the reason:

- **The tooltip is frontmost, at 100.** A tooltip is always about the thing you are pointing at, so
  anything in front of it is a hover that appears to do nothing. It has to clear the spine and both
  sticky bars.
- **The dock and its drawer sit above the mode band and the spine** (96/95, scrim 92), because the
  drawer is a surface you open *over* the reading view. The offline strip is 97, above the dock,
  since a strip the dock covers cannot tell you the thing it exists to tell you.
- **The spine is 45 and the mode band 44**, both above the reading column's own sticky furniture.
- Dialogs — comment, chat, annotate — share 70.

Two things that deliberately escape all of this: the figure **lightbox** and the **feedback dialog**
are native modal `<dialog>` elements in the browser's top layer, which is above every z-index on the
page by definition. That is the cheapest answer available for anything that must cover *everything*,
and it is worth reaching for again rather than minting a bigger number.

The full inventory is 31 declarations from 0 to 100, counted on 2026-09-06 with
`grep -nE '^\s*z-index:' src/web/styles/*.css` — a dated example rather than a fact to maintain here.
Run it before assuming a gap is free.

## What is not written down yet

The honest list. Each of these currently lives only as values under `src/web/styles/`, and someone
will eventually have to decide whether they are a system or an accident:

- **The z-index budget.** Still not a system, but no longer unwritten — see
  [the stacking order](#the-stacking-order-which-is-real-even-though-it-is-not-a-scale) above.
- **Spacing.** No scale. `rem` values chosen per rule. Control *heights* on a list page are
  settled — see [controls.md](controls.md) — but that is one row
  of one page agreeing with itself, not a scale, and it should not be read as one.
- **Breakpoints.** Exactly one, `max-width: 760px`, plus the widths at which the columns are given
  up, computed in JS rather than in CSS ([`layout.ts`](../../src/web/layout.ts)). The interesting
  responsive behaviour is not in the stylesheet at all. (The spine used to be in that sentence too,
  collapsing from 13rem to a strip on width; the expanded rail was deleted on 2026-08-26 and it is
  now one width, on or off — 12px since 2026-08-28.)
- **Motion.** Settled, mostly. One global guard in `@layer base` at the foot of
  [`tailwind.css`](../../src/web/tailwind.css) flattens every animation and transition; narrower
  blocks under [`src/web/styles/`](../../src/web/styles/) remain, for the things that are *wrong*
  when reduced rather than merely fast (a tooltip's transform, the context panel's scroll-behaviour).
  How many: `grep -rc "prefers-reduced-motion" src/web/styles/*.css` — **18 across 13 files** on
  2026-09-06. `tailwind.css` said "four" until that day, and had been wrong by more than four times
  for long enough that nobody could say when it drifted. Written globally
  before most of the motion it guards exists — which is the lesson from the previous app, where
  the guard covered two class names while fifteen keyframe animations ran regardless. Individual
  durations are still per-rule.
- **What "done" looks like.** Whether this project wants a design system, or whether this much
  well-commented CSS *is* the answer at this size, is genuinely undecided — and the number is the
  sharp end of the question. Count it with `wc -l src/web/styles.css src/web/styles/*.css`; on
  2026-09-06 that was 15,951 lines over 38 files. This line said "~1200" until 2026-09-03, and it
  was right when it was written: there was one file and it was 1,211 lines on 2026-08-25.

## Under this doc

- **[typography.md](typography.md)** — one sans for the article and the chrome alike, the weight
  axis, the vertical rhythm every gap in the article column is a multiple of, and the two kinds of
  content that cannot reflow: a wide code block, and a figure drawn in black ink for a white page.
- **[controls.md](controls.md)** — why a button in this app had a 2px white `outset` border and no
  pointer cursor for months, what our hand-written substitute for Tailwind's preflight covers, and
  the one height and one radius the controls on a list page now agree on.
- **[narrow-windows.md](narrow-windows.md)** — a row of things whose widths you do not control must
  be allowed to wrap; the reading view's columns are given up in JavaScript rather than at a
  breakpoint; and `env(safe-area-inset-*)`, every value of which is `0px` on every machine we
  develop on.
- **[design-logo.md](design-logo.md)** — the thirteen animations the wordmark plays when you point
  at it or hold it down, how they were picked from about 140 ideas, and the four ways a fourteenth
  can silently do nothing.
- **[marketing-pages.md](marketing-pages.md)** — `/` and `/features`: the `site-*` block in
  [`styles/site.css`](../../src/web/styles/site.css) and the four rules in it, how to shoot a product screenshot that shows what it
  claims to, and the two ways a full-page capture of these pages lies to you.

## See also

- [web-client.md](web-client.md) — the view all of this styles, and its constraints
- [icons.md](icons.md) — Lucide, one stroke weight, and two ways an SVG breaks a layout quietly
- [colour-scales.md](colour-scales.md) — the three palettes that are not the brand, and why every
  published one is upside down on a black page
- [tooltips.md](tooltips.md) — the one component whose appearance is entirely ours
- [original-version/overview.md](original-version/overview.md) — where the palette and the typography came from
- [browser-testing.md](browser-testing.md) — **do not judge colour from a screenshot**
- **`/design`** — not a doc but the live counterpart to this one:
  [`DesignPage.tsx`](../../src/web/DesignPage.tsx) renders every token, face, weight, button
  variant, toggle state and icon size on one page against the real ground, with contrast ratios
  computed in the browser from *resolved* values. Look at it after changing anything in
  `tokens.css`. It catches what tests cannot: a token change where every component still renders,
  nothing throws, and one variant nobody looked at is now unreadable. **Linked from `/admin` and
  shown only to the administrator** since 2026-09-05 — a courtesy rather than a gate, since the page
  is in every reader's bundle and the address answers 200 whoever asks
  ([admin.md](admin.md#the-clients-list-of-addresses-and-why-it-is-a-map-of-every-route))
- [../plans/260825a-shadcn-migration.md](../plans/260825a-shadcn-migration.md) — how the Tailwind half got here
- [../reusable/css-sticky-containing-block.md](../reusable/css-sticky-containing-block.md) —
  `position: sticky` declared correctly and doing nothing
