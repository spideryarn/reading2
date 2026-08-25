# Typography — the best doc in their whole set

`docs/reference/RESEARCH_ON_OPTIMAL_TEXT_FORMATTING.md` is ~780 lines of sourced research on
setting long-form text for screen reading. Some of it is already in
[`styles/tokens.css`](../../../styles/tokens.css) as `.reading-column`. The rest is worth having
here in full, because the reading column is the one part of this app that has to be *right* rather
than merely reasonable — everything else is scaffolding around a paragraph of prose.

Read alongside [design-css-overview.md](../design-css-overview.md), which maps our stylesheets.

**One caution before the numbers, and it is larger than it first looked.** The doc is marked
"✓ Implemented" at the top and is not. That was already known about the settings UI it specifies,
which never existed. It turns out to be true of **the typeface as well**, and we did not notice
until 2026-08-25, by which point Georgia had been sitting in our own `tokens.css` for a day with a
comment citing this document as its source.

Checked against the repo itself:

- `app/globals.css` sets `body { font-family: Arial, Helvetica, sans-serif }`.
- `--font-sans` behind Tailwind is Geist Sans; `--font-mono` is Geist Mono.
- `grep -r Georgia` over the whole repo returns **nothing**.
- `components/simple-document-viewer.tsx`, which renders the article, gives headings and body the
  same face and separates them by size and weight only: h1 `text-3xl font-bold`, h2 `text-2xl
  font-semibold`, h3 `text-xl font-semibold`, p `text-base`.

So the reading surface was **sans**, and the serif below is a recommendation that was never taken.
Greg's call on 2026-08-25 was to follow what they did rather than what they wrote — this app is now
sans throughout the reading surface too, and the reasoning is in
[../design-css-overview.md § Typography](../design-css-overview.md#typography).

**The lesson is not about fonts.** A document that says "✓ Implemented" is a claim about code, and
it is the one kind of claim in a doc that can be checked mechanically and almost never is. Two
separate things were carried out of this file into working code on the strength of that tick. Its
*citations* are real and checkable, which still puts it ahead of most of that repo — but the tick
was not, and the sourced claims below are separated from the asserted ones for exactly this reason.

Two numbers here *are* independently attested by the code, and both are kept:

- **65ch** — really shipped, as `max-w-[65ch]` on the document viewer.
- **A heading's top margin exceeds its bottom margin** — really shipped, as `mt-6 mb-4` against a
  paragraph's `mb-4`.

## Line length

- **60–65 characters** including spaces, primary recommendation.
- **55–70** acceptable, depending on complexity.
- **75 maximum**, for accessibility-guideline compatibility.

The evidence, and it is unusually good:

- **Dyson & Kipping (1998)**, *Reading and Writing* 10(6):379–393 — 55 characters gave the highest
  comprehension; **80 characters read ~7% faster but comprehended ~12% worse**.
- **Bernard, Fernandez & Hull (2002)**, *Usability News* 4(2) — preference: 55–70 chars, 85%
  approval; 95+ chars, 23% approval.
- **Shaikh & Chaparro (2005)**, HFES 49th — 95 characters was **fastest** to read (+12% speed) and
  rated **most difficult and least preferred**.

**The pattern across all three is the useful part**, and it is a warning about metrics generally:
longer lines are faster and worse. Anything that optimises reading *speed* will push you towards a
layout readers dislike and understand less well. That is [vision.md](../vision.md)'s own argument
about compression, arriving independently from typography research — and it is why our anti-goals
name "read this in 2 minutes" rather than celebrating it.

Our `.reading-column` is set at 65ch, inside the recommended band.

## Size, weight and font

- **17px (1.0625rem)** body, range 16–18px; 18–24px for accessibility.
- **16px minimum** — below that, iOS Safari zooms the page on input focus.
- **400 weight** for body; 500–600 emphasis; 600–700 headings. Below 300 causes trouble for
  low-vision readers. *(asserted, uncited)*
- By device: mobile 17–18px, tablet 16–17px, desktop 16–18px — closer viewing distance on a phone
  compensating for the smaller screen. Stated viewing distances: phone 32–36cm, tablet ~40cm, laptop
  ~50cm, desktop ~60cm.
- WCAG "large text" begins at 18pt (24px), or 14pt bold (18.5px). The British Dyslexia Association
  is cited for 14–18pt.

**Georgia** is the recommendation, on an x-height argument: 0.485 versus Times New Roman's 0.448,
about 10% larger lowercase. **It was never used** — see the caution above. Alternatives with their x-heights: Merriweather 0.471, Palatino Linotype
0.460 (needing 15–20% more vertical space), Source Serif 4.

One claim to distrust: *"15% faster reading speed vs Times New Roman on screens"* is sourced only to
the NIH's grant-formatting guide, which is a formatting rule, not a reading study. **The x-height
number is checkable and the speed claim is not.**

## Line height and vertical rhythm

- **1.4** stated as the academic optimum *(uncited)*.
- **1.5** WCAG minimum for accessibility.
- **1.6** for dyslexia or visual impairment.

From these they derive a **rhythm unit** — 17px × 1.4 = 23.8px — and hang all vertical spacing off
it: paragraph margin 1 unit, tight spacing 0.5, section spacing 2 units, and heading top margins
larger than bottom margins so a heading groups with the text it introduces.

That last rule is the one most often got wrong and costs nothing to get right: **a heading belongs to
what follows it**, so the space above it must exceed the space below.

The rhythm system is arithmetic rather than evidence — their own construction — but it is a good
piece of arithmetic, and it is the kind of thing that makes a page look considered rather than
assembled. Worth adopting as CSS variables.

## Contrast

Their dark-mode values, which are the relevant ones for us
([web-client.md § Dark mode](../web-client.md#dark-mode)):

| Text | Background | Ratio |
|---|---|---|
| `#e8e8e8` | `#1a1a1a` | 13.4:1 |
| `#f5f5f5` | `#2d2d2d` | 11.8:1 |
| `#faf8f5` | `#262626` | 14.2:1 (warm, less blue light) |

Target **WCAG AAA (7:1)** for extended reading, with AA (4.5:1) as the floor. Every one of their
pairings clears AAA by a wide margin, which is the right instinct for a page someone stares at for
fifty minutes.

## Per-genre variation

Line length by content type: scientific papers 55–65, philosophy 55–70, policy 60–70, business plans
60–75. These are stated as design rationale rather than findings — no citation per genre.

The per-genre detail is more interesting than the line lengths:

- **Scientific papers** — inline maths in a consistent maths font (STIX, Latin Modern Math); block
  equations with `overflow-x: auto`; complex formulas may need 80–100ch with horizontal scroll;
  **figure captions at a shorter 45–50ch** so they read as belonging to the figure; technical terms
  set with slightly increased letter-spacing (0.03em); sub/superscripts no smaller than 75%.
- **Philosophy** — 60–65ch "allows for re-reading and careful parsing"; **paragraph spacing at 1.75
  rhythm units**, extra room for logical breaks; blockquotes set *tighter* (1.3) and *narrower*
  (60ch) than body text, so they read as a different voice rather than as more of the same.
- **Policy** — 65–70ch to balance clause-reading against scanning; explicit heading scale
  (`h1 1.75rem/700`, `h2 1.5rem/600`, `h3 1.25rem/600`, `h4 1.125rem/500`); auto-numbering via CSS
  `counter-reset`; generous 3rem margins **for note-taking**.

Three of these are directly usable here and cost almost nothing: **shorter measure for captions**,
**tighter and narrower blockquotes**, and **`overflow-x: auto` on anything that can't reflow**. The
last one matches a rule we already hold for other reasons — wide content scrolls inside its own
container, never the page.

*All three taken, 2026-08-25* (`styles.css` § text), with one deliberate deviation: their
blockquote leading of 1.3 was written for Georgia and is too tight for a sans on a dark ground,
where lines close up visually as well as metrically. Ours is 1.45 — same intent, right number for
the face. The `overflow-x` one turned out to be a live bug rather than a refinement: this view
scrolls the page horizontally by design and pins the masthead and spine to that scroll, so a single
wide code block dragged the whole article's furniture sideways.

## What they wanted and never built

The doc's "future enhancements" section is a wishlist, and none of it exists:

- `text-wrap: balance` on headings, with an `@supports not` fallback to `max-width: 20ch`. **This one
  is now cheap and well-supported, and would improve our masthead today.** *Taken, 2026-08-25* — on
  the masthead title and on all six heading levels inside `.prose`. The fallback turned out to be
  unnecessary: unsupporting browsers ignore the declaration and wrap normally, which is the
  behaviour we had anyway.
- Container queries, so type responds to its container rather than the viewport.
- Variable fonts, including a nice idea: **add ~50 to the weight axis in dark mode**, because light
  text on dark ground optically thins. *Taken, 2026-08-25* — Geist arrived as a variable face with a
  100–900 axis, so `--reading-weight` is 450 rather than 400. Their own doc could not use this
  advice; it is the one wishlist item that became possible by accident.
- A reader settings UI (`CoreSettings { fontSize, lineHeight, colorScheme }`), described as "Phase 1
  MVP". Never built.
- AI-driven complexity detection auto-tuning the layout; eye-tracking metrics; A/B testing;
  longitudinal reading-performance tracking over four-week periods.

**The bottom half of that list is the cautionary part.** Eye-tracking interfaces and longitudinal
session tracking were specified in TypeScript, in a reference document, for an app that never got a
font-size control. Specifying the ambitious thing is how the cheap thing goes unbuilt — and the
cheap thing here (hardcode good values) is 80% of the benefit.

**So: hardcode the values, skip the settings UI.** A reader who wants bigger text has a browser zoom
control that works on every site they visit.

## What is missing entirely

Nothing on **hyphenation, justification, or widows and orphans** — confirmed by grep, not inferred.
That is a real gap in an otherwise thorough document, and the questions are live for us:

- Ragged right or justified? (Ragged, almost certainly — justified without hyphenation gives rivers,
  and CSS hyphenation quality varies by browser.)
- `hyphens: auto` on a 65ch measure? Worth trying; it is one line.
- Orphan and widow control? `orphans`/`widows` do nothing in most browsers for screen media, so this
  is really a question about `break-inside` if we ever paginate.

Answer these ourselves when they come up, and write the answer into
[design-css-overview.md](../design-css-overview.md) rather than here.

## See also

- [overview.md](overview.md) — the map to that codebase
- [design-system.md](design-system.md) — tokens, icons, loading, and the rest of the visual layer
- [../design-css-overview.md](../design-css-overview.md) — our stylesheets and which mechanism owns what
- [../web-client.md](../web-client.md) — the reading view and its constraints
- [`styles/tokens.css`](../../../styles/tokens.css) — where the lifted values live
