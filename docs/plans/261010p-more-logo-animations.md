# More wordmark animations — thirteen more, from four directions

Up: [design-logo.md](../project/design-logo.md) · report spya-axbxr8 (#539, SPIDERYARN-READING2-GM)

> Logo animations that we have, that we show when loading an article are really fun. Let's generate
> a bunch more. Perhaps try prompting the agents from a couple of different directions and also get
> some input from GPT-Sol. Take into account the vision.md and the different modes and, you know,
> what we're trying to do here, and then really have fun with it.
>
> — Greg, 2026-10-09

## What this does

Adds **thirteen** animations to the wordmark's set (fourteen → twenty-seven): seven that move only
the spider, six that move only the letters. Twelve join the article loader's two tracks; one
(*Played Dead*) is hover-only, because a grey spider on an empty loading page reads as an error.
Nothing about the machinery changes: one stylesheet, one registry array, one loader table, the
tests' own lists. `/design` picks them up with no edit.

## How they were chosen

Four longlists, about fifty ideas, each from a different direction as Greg asked, all written
against one [brief](261010p-more-logo-animations-brief.md):

- [the reading modes](261010p-more-logo-animations-longlist-modes.md) — the wordmark briefly
  *becomes* a mode (Claude subagent);
- [the vision](261010p-more-logo-animations-longlist-vision.md) — what reading deeply looks like,
  acted out (Claude subagent);
- [the spider, yarn and motion craft](261010p-more-logo-animations-longlist-spider.md) — real spider
  behaviour, squash and stretch (Claude subagent);
- [wildcards, letterforms and the loader](261010p-more-logo-animations-longlist-sol.md) — GPT Sol.

Arbitrated the way the first set was ([design-logo.md § How the thirteen were chosen](../project/design-logo.md#how-the-thirteen-were-chosen)):
**diversity scored on the set**, against the fourteen already there as well as each other. Two lists
independently proposed *In Quotes*, two proposed Skim's three passes, and two the loom's odd/even
shed — taken as votes. A spider-heavy split, because the word is hidden on most reading-view widths
(design-logo.md § What a phone sees): mark-only goes from six of fourteen to thirteen of
twenty-seven, keeping the ratio near half.

## The thirteen

Each says what it is, its source list, and how it lands under reduced motion (the global guard
flattens durations and iteration counts; every one below rests at its base style — pseudo-elements
are declared statically invisible with an explicit resting `transform`, per the stylesheet's rules).

### The spider (reach: mark)

| # | id | Name | What the reader sees | From | Loader hold |
| --- | --- | --- | --- | --- | --- |
| 15 | `spya-hop` | **Hop** | Crouches (squash), springs up stretched, hangs, lands with a squash and wobble; a faint orange footprint below shrinks as it rises and spreads as it lands. Up, where Dragline is down. | spider | 1 × 1.6s |
| 16 | `spya-asterisk` | **Asterisk** | Contracts and rises until its legs read as a tiny superscript asterisk before the word — a footnote mark — pauses, unfurls. The mark already contains its second form. | Sol | 1 × 1.8s |
| 17 | `spya-magnifier` | **Magnifier** | A small lens (ring and handle) glides in from the lower right, stops over the spider, which swells inside it as if found; the lens lifts away. Search mode. | modes | 1 × 2s |
| 18 | `spya-pacing` | **Pacing** | Walks three pixels right with a bob on each step, turns (a squash through edge-on to its mirror), walks left past its slot, turns, back to the middle. Someone waiting for something to arrive. | spider | 1 × 3s |
| 19 | `spya-lines` | **Line by Line** | The spider reads: four tick-stops of a small turn left to right, a sweep back and a pixel down for the next line, three lines, then home. | vision | 1 × 2.4s |
| 20 | `spya-dead` | **Played Dead** | Flinches, tips onto its back with a bounce, goes grey; one leg-twitch; rolls the rest of the way round, upright, orange, innocent. Hover only. | spider (killed in September as "looks the same upside down"; re-proposed, the grey and the twitch carrying it). **Conditional** on the browser check. | excluded |
| 21 | `spya-semaphore` | **Semaphore** | One raised foreleg waves twice like a peacock spider flagging, the other answers. The first time the mark has a limb. **Conditional** on the browser check at 1× and 2.2×. | spider | 1 × 1.8s |

### The letters (reach: letters)

| # | id | Name | What the reader sees | From | Loader hold |
| --- | --- | --- | --- | --- | --- |
| 22 | `spya-quotes` | **In Quotes** | Orange curly quotes slide in at cap height either side: “Spideryarn”. Hold, drift out. Quotes mode, and the name as a line worth keeping. | modes + vision | 1 × 1.8s |
| 23 | `spya-click` | **It Clicks** | The letters drift slightly out of true, each its own small tilt and nudge, then all ten snap straight *at the same instant* with one warm flash. The moment of understanding — the only simultaneous gesture in the set. | vision | 1 × 1.8s |
| 24 | `spya-shed` | **The Shed** | Odd letters rise a pixel and evens drop, as a loom opens its warp; they cross over; then all snap level with a small downward knock — the reed beating the weft home. | spider + Sol | 1 × 1.6s |
| 25 | `spya-xref` | **Cross-reference** | A fine orange arc grows from the first `r` to the second, over `ya`, holds as if one cites the other, retracts. The word's own repetition, linked. | Sol | 1 × 1.6s |
| 26 | `spya-skim` | **Three Readings** | Skim's three passes: three scattered letters light, a pause, six, a pause, then all ten. Dew's glow, Skim's shape. | modes + Sol | 1 × 3s |
| 27 | `spya-tex` | **Set in TeX** | The letters lean one by one into an italic slant, as if typeset as ten maths variables multiplied together, hold, and straighten. Maths mode. | modes | 1 × 1.4s |

Loader holds are one whole loop of an `infinite` animation with no delay on the loader target, or
the complete run of a one-shot; the exact figures are set from the stylesheet and checked by
`tests/logo-loader.test.tsx` as for every other entry. Where a hover loop has a long rest, the loader
holds one loop.

### Mechanisms, briefly

All within the stylesheet's five rules (design-logo.md § Adding one): class-driven, never
`.logo-text`, rest at 100%, no box change, letters' rest colour as `--wordmark-ink`.

- **Hop, Asterisk, Pacing, Line by Line, Played Dead** — keyframes on `.logo-image` `transform`
  (Played Dead adds a `filter` grey and uses the individual `rotate` property so 360° lands at rest).
  Hop's footprint is `.logo-mark::after`, resting `opacity: 0` and `transform: scaleX(0)`.
  Vertical: Hop rises ≤7px (the dock has about 9.5px above the 21px spider in a 40px bar); Line by
  Line drops ≤2px; nothing goes below Dragline's measured 8px.
- **Magnifier** — `.logo-mark::after` is the ring, `::before` the handle, both resting `opacity: 0`
  and translated out; `.logo-image` scales to 1.25 inside. Tokens: ring `--wordmark-ink`.
- **Semaphore** — Radius Sweep's machinery: two `.logo-mark` pseudos painted `--highlight` and masked
  to the PNG, each `clip-path`ed to one foreleg's quadrant and rotated about its joint, while
  `.logo-image` gets the complementary `clip-path` so the real legs are hidden under the painted
  ones. Gated in `@supports` like Radius. Coordinates come from the PNG (the spider list measured
  them) and are verified at 2.2× in the browser; **if the wedge at the joint shows, or the leg does
  not read as a leg, it is dropped** and this plan says so.
- **In Quotes** — `:nth-child(1)::before { content: "\201C" }` and `:nth-child(10)::after
  { content: "\201D" }`, `--highlight-text`, resting `opacity: 0`, sliding in by `--logo-px`. The
  opening quote sits in the gap before the S at cap height; measured against the spider in each
  host. Where "Reading" follows the name (`.site-wordmark-host`), the closing quote is checked for
  collision and, if it collides, both quotes are drawn there or neither — never one.
- **It Clicks** — ten hand-picked `--r`/`--dy` pairs by `:nth-child`, one keyframe reading them
  (`var()` resolves per element), no stagger, glow in `text-shadow` only.
- **The Shed** — `--shed: ±1` by odd/even, one keyframe, no stagger.
- **Cross-reference** — `:nth-child(6)::after`, a top-bordered rounded box from the first `r`'s
  centre to the second's, in the clear band between x-height and cap height (`ya` are x-height
  letters), `scaleX` from the left, resting `scaleX(0)`. Width in `em`, measured in Geist.
- **Three Readings** — three keyframe sets by pass membership (n, S, y first; d, r, i second; the
  rest third), each a Dew-style colour + glow peak with no 0%/100% colour stop. Order within a pass
  comes from the keyframe percentages, not delays, so the loader test can read the timing.
- **Set in TeX** — `skewX(-11deg)` about the baseline, `calc(var(--i) * 35ms)` stagger in a single
  keyframe whose hold absorbs the return.

## Loader exclusions and the tests

- `LOADER_EXCLUDED["spya-dead"]`: "a grey spider on an empty loading page reads as an error".
- `tests/logo-animation.test.tsx`: `LETTERS_ONLY` gains the six letters ids; "fourteen" wording and
  the (13/14)^200 arithmetic become twenty-seven.
- `tests/logo-loader.test.tsx`: the `timedTargets` count table gains the twelve tracked ids.
- No new test kind is needed — every new id is covered by the existing registry/stylesheet,
  reach-tag, resting-transform, resting-colour, `--logo-px`, track-half and hold-timing guards.

## Simpler options passed over

- **Fewer** (four, say). Greg asked for "a bunch" and to have fun; the apparatus cost is fixed and
  already paid, and an animation is ~20–40 lines of CSS. The constraint that matters is range, which
  thirteen chosen as a set keeps.
- **Weighting or rarity** (a rare Played Dead). A second mechanism; design-logo.md § What is
  deliberately not here rules it out, and it stays out.
- **New elements or an SVG trace** for Semaphore. Same doc, same reason; masked overlays do it.

## Near-misses, for the next round

From the longlists, in rough order: *Narrowing* (a ring closing in — cut as a second ring beside
Magnifier), *Typing…* (chat's three dots; 1px dots at 1×), *The Tilt* (the `y` — *why* — tilts like
a head), *Fixations* (underline hops with a regression), *Double Take*, *Turn It Over* (a
`rotateX` flip; Pacing already flips), *Cross-section*, *Bookmarked*, *Pholcid Whirl*, *Cited*
(a superscript 1 reads as a notification badge), *Cloze* (missing letters look broken).

## Stages

1. This plan; GPT Sol plan review (read-only).
2. Build: stylesheet, registry, loader table, tests, docs (design-logo.md, loading-spinner.md, the
   stylesheet's header count). `npm test` on the two logo suites, `npm run typecheck`.
3. Browser check in a Sonnet subagent: `/design` gallery at 1× and the loader at 2.2×, the dock at
   1280 and 2560, the corner, the shelf heading, the marketing bar; reduced motion. Decide
   Semaphore.
4. GPT Sol code review (workspace-write, fixes what it finds); gates; commit; push to `dev`.
5. Feedback note in `docs/user-feedback/`, ending *shipped*.

## The browser check

A Sonnet subagent with Playwright against the worktree's dev server, frames sampled by pausing
`document.getAnimations()` at exact times, three rounds. Both conditional entries passed:

- **Semaphore** reads as legs waving at 1×, 2× and on the 2.2× loader. At rest the copies first left
  a dark hairline across both legs where the clipped edges met; overlapping each copy 1.5% past its
  hole replaced it with a much fainter lighter line, measurable at 4×, barely visible on the loader,
  invisible at native size. Accepted, and said so in the stylesheet.
- **Played Dead** "reads as a spider playing dead, not as something broken".
- **Pacing's** mirror reads as the spider turning. **It Clicks and The Shed** read as clearly
  different gestures at 1×, so both stay.
- **Hop** clears the dock's top by 4.2px at take-off, 4.9px at the apex.
- **Reduced motion**: all thirteen leave no running animation, and twelve are identical to the
  resting wordmark; Semaphore differs by the faint line above. No console errors.

What it found wrong, all fixed:

- **Cross-reference** touched the tops of both `r`s: Geist's clear band is only 3.57–5.83px below
  the letter box top. Now 3.4–5.5. Its width was measured on the static word; `spya-anim` makes the
  letters inline-block, which drops kerning, so the animating distance is 21.25 wordmark pixels, not
  20.5.
- **In Quotes'** opening quote touched or overlapped the spider in four hosts. Tucked one wordmark
  pixel into the S's box, and scaled 0.8 on the shelf, where a 30px heading sets it beside a 10px
  gap: now 2.0–2.3px clear of the spider everywhere and about 1px clear of the S.
- **Magnifier**'s swollen spider poked through the ring: ring 4px clear, swell 18%.
- **It Clicks** was orange throughout the muddle, because its colour was named only at the snap and
  CSS eased towards it from the first frame (found by reading the screenshots, not reported by the
  agent). The resting ink is now pinned either side of the flash.

## Review

Sol's plan review: [261010p-more-logo-animations-review-sol.md](261010p-more-logo-animations-review-sol.md)
(verdict "revise before build", two blockers). What was done with each finding:

1. **TeX's hold (blocker)** — taken. One-shot everywhere, held 1715ms (315ms stagger + 1.4s).
2. **Semaphore's delayed leg (blocker)** — taken. Two delay-free 1.8s keyframes; the answer's pause
   is in the percentages.
3. **Semaphore's fallback** — taken. Gated on `clip-path: polygon(evenodd, …)` support as well as
   the mask; the resting reconstruction is checked in the browser, and it is dropped if not clean.
4. **Cross-reference in `em`** — lengths written in `--logo-px` for consistency. No new test: `em`
   scales with the word exactly as `--logo-px` does (it *is* an `em`), so there is no defect class
   for a test to catch; the existing guard's target is fixed pixels.
5. **In Quotes on the marketing bar** — taken. "Reading" moves aside by the closing quote's width on
   the same 1.8s clock, as Seam already moves it; a test asserts the marketing rule animates.
6. **Hop's headroom** — taken. Take-off `translateY(-4px) scale(.94, 1.08)`, apex −5px: the top
   lifts ≤5.7px.
7. **Played Dead** — the IoU citation corrected (the shortlist used it against the idea). Kept, and
   made conditional on the browser check like Semaphore, with a shorter upside-down phase; a hover
   that ends mid-pose snaps upright, as Strain snaps mid-lean.
8. **It Clicks vs The Shed** — judged side by side at 1× in the browser check; the weaker goes.
9. **Pacing's mirror** — the browser check compares the held mirror with the original.
10. **Counts and the inventory** — taken: the registry's and stylesheet's counts, design-logo.md's
    current-count passages, loading-spinner.md's exclusions, and every new target in the loader
    test's table.
