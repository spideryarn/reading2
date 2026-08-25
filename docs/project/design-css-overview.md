# Design and CSS: an overview

**This is a stub.** It exists to answer one question — *where does a style live, and which
mechanism owns it?* — because the answer is currently spread across four files and three other
docs, and every new agent has to reconstruct it. What is written below is true and checked. What
is missing is listed at the bottom, honestly, rather than left for you to discover.

Nothing here restates [web-client.md](web-client.md), [icons.md](icons.md) or
[tooltips.md](tooltips.md). This is the map; those are the territory.

## The four files, in load order

`main.tsx` imports **one** stylesheet, and it is not the one you would guess.

| # | File | What it holds |
|---|---|---|
| 1 | [`src/web/tailwind.css`](../../src/web/tailwind.css) | **the entry point.** The `@layer` statement, the Tailwind imports, the token bridge, the source-scanning rule |
| 2 | `tailwindcss/theme.css` + `utilities.css` | Tailwind v4, prefixed `tw`, in layers `theme` and `utilities`. **Preflight is deliberately not imported** |
| 3 | [`src/web/styles.css`](../../src/web/styles.css) | every hand-written rule, ~1200 lines, imported by *file 1* so it lands in `@layer app` |
| 4 | [`styles/tokens.css`](../../styles/tokens.css) | the brand palette and the four font stacks, imported in turn by *file 3* |

The nesting is the load-bearing part. Importing `styles.css` from `main.tsx` alongside
`tailwind.css` **does not work** — it lands unlayered, outranks every utility, and Tailwind
silently does nothing. The full reasoning is in the header comment of
[`tailwind.css`](../../src/web/tailwind.css) and in
[web-client.md § Four guards](web-client.md#four-guards-all-in-tailwindcss).

## Which mechanism owns what

Three mechanisms can style the same element, and picking wrongly is how the cascade fights get
started. The rule of thumb:

- **`styles.css`** owns anything structural, anything that reads as a *system* — the table
  geometry, the spine, the tooltip card, the reading typography. Semantic class names
  (`.spine`, `.gist`, `.prose`) are the interface; [web-client.md § Never delete a semantic class
  name](web-client.md#never-delete-a-semantic-class-name) says why they must not be replaced by
  utility soup even where they carry no rules.
- **Tailwind utilities**, written `tw:flex`, `tw:hover:bg-accent` — v4 colon syntax, not the v3
  dash — own one-off adjustments inside components, mostly where a shadcn component needs
  nudging.
- **shadcn components** in [`src/web/components/ui/`](../../src/web/components/ui/) own
  `button`, `toggle` and `collapsible`, and nothing else. What is staying hand-written, and why,
  is in [web-client.md § Tailwind and shadcn](web-client.md#tailwind-and-shadcn-components).

The longer version, with the bugs that made each boundary necessary, is
[shadcn-migration.md § Which mechanism does what](../plans/shadcn-migration.md#which-mechanism-does-what).

## Colour: one source, dark only

[`styles/tokens.css`](../../styles/tokens.css) is the single source of truth. Two things follow
from that, and both bite:

- **Dark only, unconditionally.** No toggle, no `prefers-color-scheme`, no light fallback —
  Greg's call, 2026-08-24. [web-client.md § Dark mode](web-client.md#dark-mode) has the quote and
  what to do if light mode ever comes back.
- **`--accent` is a raised dark *surface*, not the orange.** That is shadcn's meaning of the name,
  and shadcn's own components walk straight into it. Anything meaning the brand orange says
  `--highlight`. See the token block at the top of
  [`styles.css`](../../src/web/styles.css), and
  [shadcn-migration.md § Trap A](../plans/shadcn-migration.md#the-token-bridge).

The semantic layer at the top of `styles.css` (`--ink`, `--page`, `--panel`, `--surface-raised`,
`--rule`) sits over the brand tokens so the rules below read in reading-view terms rather than in
shadcn surface names. On a dark ground the greys run the other way: *soft* and *faint* are darker,
not lighter.

One trap worth repeating here because it is invisible: **mix colours in `oklab`, not `oklch`.**
`--page` is written `oklch(0.145 0 0)`, a hue explicitly specified as 0 rather than missing, so
polar interpolation drags a mix round to 11.7° and the result is quietly pink instead of warm.
`--highlight-wash` escapes only by using `in oklab`.

## Typography

Four stacks, all in [`tokens.css`](../../styles/tokens.css), and the split is deliberate:

| Token | Used for |
|---|---|
| `--font-reading` | Georgia — the article itself, and the reader's own words in a comment |
| `--font-ui` | system-ui — chrome: controls, masthead facts, column headers |
| `--font-mono` | block ids, counts, anything that wants to line up |
| `--font-brand` | the wordmark, and only the wordmark |

The reading measure and the size numbers came from the original app's research doc, not from
taste — [original-version/overview.md](original-version/overview.md) says what was carried over.

## What is not written down yet

The honest list. Each of these currently lives only as values in `styles.css`, and someone will
eventually have to decide whether they are a system or an accident:

- **The z-index budget.** Nine values between 1 and 80, and their ordering is real — the spine is
  45, the tooltip 80 *because* it must clear the spine and both sticky bars. Written as a comment
  on one line of `styles.css`, nowhere else. This is the most likely thing to break next.
- **Spacing.** No scale. `rem` values chosen per rule.
- **Breakpoints.** Exactly one, `max-width: 760px`, plus the collapse widths the spine and the
  columns compute in JS rather than in CSS ([`layout.ts`](../../src/web/layout.ts)). The
  interesting responsive behaviour is not in the stylesheet at all.
- **Motion.** Two `prefers-reduced-motion` blocks, written independently. Durations are per-rule.
- **What "done" looks like.** Whether this project wants a design system, or whether ~1200 lines
  of well-commented CSS *is* the answer at this size, is genuinely undecided.

## See also

- [web-client.md](web-client.md) — the view all of this styles, and its constraints
- [icons.md](icons.md) — Lucide, one stroke weight, and two ways an SVG breaks a layout quietly
- [tooltips.md](tooltips.md) — the one component whose appearance is entirely ours
- [original-version/overview.md](original-version/overview.md) — where the palette and the typography came from
- [browser-testing.md](browser-testing.md) — **do not judge colour from a screenshot**
- [../plans/shadcn-migration.md](../plans/shadcn-migration.md) — how the Tailwind half got here
- [../reusable/css-sticky-containing-block.md](../reusable/css-sticky-containing-block.md) —
  `position: sticky` declared correctly and doing nothing
