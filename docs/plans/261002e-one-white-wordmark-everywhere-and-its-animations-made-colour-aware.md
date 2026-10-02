# One white wordmark everywhere, and its animations made colour-aware

Report spya-p52ccp, a suggestion from Greg (admin), filed 2026-10-02 from `https://www.spideryarn.com/`:

> Sometimes the Spideryarn logo has white text, and sometimes it has orange text. I think probably
> the white text is better. Investigate, take screenshots, use your judgment, standardise (perhaps as
> a reusable flexible component), and include & build on & improve the animations.
>
> — Greg, 2026-10-02

## What is true today

The spider and the ten letters are already one component — `LogoMark` and `LogoLetters` in
[`LogoGlyphs.tsx`](../../src/web/LogoGlyphs.tsx), since 260929c. What is *not* shared is how the
letters look at rest. Each host sets that itself, and they have drifted:

| Host | Where a reader sees it | Colour set by | Colour | Weight |
| --- | --- | --- | --- | --- |
| `HomeLogo` (`.logo.logo-home > .logo-text`) | `/add`, `/profile`, `/contact`, `/privacy`, admin, 404, the article's error screens | `.logo` (dock.css) and `.logo-text` (tokens.css) | **orange** | 600 |
| `DockHome` (`.logo.dock-home > .dock-btn-label`) | the reading view's bottom bar, only at ~2560px (the fit ladder hides the word below that) | `.logo` (dock.css) | **orange** | inherited |
| `SiteBits § Wordmark` | marketing bar and every `SiteFooter` — `/`, `/features`, `/pricing`, the shelf's footer | `tw:text-foreground` | white | 500 |
| `Library § ShelfWordmark` | the shelf's `<h1>` | `tw:text-foreground` | white | h1 default |
| `LogoLoader` | the article page while it fetches | `tw:text-foreground` | white | 400 |
| `/design` gallery | `/design` § Wordmark animations | `.logo` | orange | mixed |

Before-screenshots and computed styles: § Evidence below.

**And two of the thirteen animations assume the orange.** `spya-strain-hold` and `spya-dawn-glow`
(logo-animations.css) write `color: var(--highlight)` into their 0% and 100% keyframes, so on every
white copy — the marketing bar, the footer, the shelf — the word turns orange for the length of the
animation and then *snaps* back to white when it ends. That is the one way this file says an
animation must never end ("return to the resting state at 100%").

## Why white

- **The spider is already orange.** Orange letters beside an orange mark make the word compete with
  the mark rather than name it; white letters let the spider carry the colour, which is what a mark
  is for.
- **The first copy a stranger sees is white** (the marketing bar on `/`), and so is the biggest one
  (the shelf heading). Making the corner match those changes the small copies, not the prominent ones.
- **Orange becomes available to the animations.** While the word rested orange, an animation could
  only lighten it (`--highlight-ink`). Resting white, the orange can *arrive* — which is how Strain
  and Dawn are rewritten below, and what the new animation is.
- Greg's own lean, and the overseer's brief, both say white.

## The change

### Stage 1 — one resting look, owned by the glyphs

One rule, keyed on `.logo-letter` — the class only `LogoLetters` emits — sets the name's face,
weight, tracking and colour: `font-family: var(--font-brand)`, 600, `letter-spacing: 0.02em` (the
corner's and the Dock's, which `.logo` used to supply; Sol's P2.2), `color: var(--wordmark-ink)` — a
new token, `var(--foreground)`, which the colour animations can name. Every
host then *gets* the look by drawing the shared letters, and cannot drift from it by forgetting a
class. The per-host settings come out: `.logo { color: var(--highlight) }`, `.logo-text`'s colour
and weight, and the `tw:text-foreground` / `tw:font-prose` that `LogoLoader` and the shelf put on
the letters' wrapper. **Size stays the host's**: 0.82rem chrome, 1rem bar, 30px heading are
legitimately different, and the animations already scale with it (`--logo-px`).

`.site-wordmark-rest` ("Reading", after the name on marketing pages) stays orange: it is not the
name, and the orange word after the white one is the one place the lockup is deliberately two-tone.

The weight: decided from the screenshots (§ Evidence). Default 600, the corner's, which is the
weight the brand token was introduced for.

The `.dock-home` / `.logo-home` hover stays `opacity 0.85 → 1`; its comment's reason ("the wordmark
is already `--highlight`, every other colour would be a step down") becomes "already the brightest
ink", which is the same argument.

### Stage 2 — the animations, colour-aware, and one more

1. **Strain and Dawn stop writing the resting colour.** Their rest stops name `--wordmark-ink`
   rather than `--highlight`, and their peak is the orange. Strain's letters now *flush orange* as
   the spider lets go, and Dawn's word arrives orange and cools to white — the spider's colour
   passing into the name. (Omitting the 0% stop instead was the first idea; Sol's P1.1 pointed out
   that Strain would then ease toward the flush from the start of the haul, so its 56% hold needs a
   named rest colour — hence the token.) A test fails on any keyframe that writes a colour other
   than `var(--wordmark-ink)` at 0% / 100% / `from` / `to`, watched red against today's sheet
   first (Strain once, Dawn twice). Strain is still an infinite loop, so leaving it mid-flush still
   cuts the colour — as every infinite loop here already does; "no snap" means at its ends.
2. **A fourteenth animation, *Dew on the Thread*** (`spya-dew`, `reach: "letters"`): a bead of the
   spider's orange runs once along the word, left to right, each letter warming and cooling in turn
   with a faint glow, and the word is white again when it has passed. Colour and `text-shadow` only,
   so no box changes; ends at the base style by construction (no 0%/100% stops); reduced motion
   leaves the white word. It is the first animation that is *about* the white/orange contrast, and it
   is a letters animation that is calm enough to run in the loader's letters track
   (`LOADER_HOLD_MS`), where the restrained ones are welcome.

### What is deliberately not done (deferred, by name)

- **One `<Wordmark>` React component that owns the host, the hook and the wrapper for all six
  copies.** The hosts differ on purpose — `.logo-text` is the 731px query's, `.dock-btn-label` the
  fit ladder's, the shelf's is a heading, the bar's is a link with "Reading" after it
  (design-logo.md § The two mount points). Folding them into one component with props for each
  difference is a larger refactor with layout risk in the dock, and it does not change what a reader
  sees. The resting look living with `LogoLetters` is the part of "a reusable component" that fixes
  the drift. Worth doing if a seventh copy appears.
- **A light theme.** The app is dark-only; `--foreground` would carry it if that changed.
- **More colour animations.** One, and see how it reads.

## Evidence

**Before**, measured by a Sonnet browser subagent on this worktree's build (local dev server,
dev-admin), `getComputedStyle` on the first `.logo-letter`. Every copy is Geist Variable.

| Copy | Colour | Weight | Size | Host opacity |
| --- | --- | --- | --- | --- |
| Marketing bar (`/`, `/features`, `/pricing`) | white, "Reading" orange | 500 | 16px | 1 |
| Footer (every `SiteFooter`) | white, "Reading" orange | 500 | 14px | 1 |
| Shelf heading | white | **700** (h1 default) | 30px | 1 |
| `HomeLogo` corner (`/profile`, `/design`, …) | **orange** | 600 | 13.12px | 0.85 |
| `DockHome` (reading view, 2560 only; hidden at 1440) | **orange** | **400** | 13.12px | 0.85 |
| `LogoLoader` | white | **400** | 13.12px ×2.2 | 1 |
| `/design` gallery | orange | 600 | 13.12px | 1 |

So the drift is in weight as well as colour: four weights for one name. Screenshots were kept
locally (scratchpad, not committed — they are of a dev build).

**The weight: 600.** It is the corner's, the one the brand token was introduced for, and the crops
show it holding at both ends — crisp at 13px, and at 30px a heading without the h1's 700 shouting.
On the marketing bar it gives the name a step over "Reading" (500), which is the right way round.
The 0.85 resting opacity on the corner and the Dock stays: it is their hover affordance, and a
slightly dim white is still white.

**After**, the same subagent method on the built change (its own vite on this worktree):

- **Every copy** — marketing bar and footer on `/` and `/pricing`, the shelf heading, the `/profile`
  corner, the Dock at 2560, `/design`'s header, gallery and loader sample — computes `oklch(0.97 0
  0)`, 600, Geist, `0.02em`. Size still the host's (13.12 / 14 / 16 / 30px). The one cell that read
  orange was `/design`'s Strain cell, caught mid-loop.
- **Strain, Dawn, Dew**, applied by class on the marketing bar and the `/profile` corner and sampled
  every 100ms on letters 1, 5 and 10: each goes orange in its middle and the last sample before
  the class goes has zero chroma — no snap. Dew's bead travels left to right (letter 1 orange at
  ~200–700ms, letter 10 at ~810–1330ms). A real hover still plays an animation.
- **The marketing bar at 390**: no overflow. **At 320** the bar's content is 318px. It fits a 320px
  phone, whose scrollbars overlay, but headless Chrome's 15px classic scrollbar leaves 305, so a
  strict `scrollWidth === clientWidth` fails there. About 5px of the 318 is this change (600 and
  the tracking, at 1rem). So that case was already over before the change, and it is not a phone
  case. Left as it is, and written here so the next person who measures it knows.

## Reviews

- Plan: GPT Sol (`gpt-5.6-sol`, high, `--sandbox review`), exit 0, answer file fresh. No P0. Taken:
  P1.1 (Strain needs a named rest stop — the token), P1.2 (a fourteenth needs `LETTERS_ONLY`, the
  loader's hold and timed-target map, and the count prose swept), P2.1 (measure the marketing bar's
  fit at 320 and 390; the shelf was 700, not "default"; "Reading" stays 500 deliberately), P2.2
  (tracking centralised too). It confirmed omitted stops take the underlying value, that animation
  values outrank the letters' declared colour, that Retype's `currentColor` cursor follows the
  letter, and that the Dock's fit ladder remeasures, so a wider 600 word only drops a little sooner.
- Code: GPT Sol, workspace-write — (pending).

## Done looks like

Every copy's letters compute to the same colour and weight at rest (browser-checked on each page in
the table); Strain and Dawn end on the host's colour with no snap; `spya-dew` plays on hover and in
the loader; `npm test` and `npm run typecheck` green; design-logo.md and loading-spinner.md updated.
