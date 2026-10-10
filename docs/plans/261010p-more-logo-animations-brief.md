# More wordmark animations — the brief for the longlists

Up: [261010p-more-logo-animations.md](261010p-more-logo-animations.md)

> Logo animations that we have, that we show when loading an article are really fun. Let's generate
> a bunch more. Perhaps try prompting the agents from a couple of different directions and also get
> some input from GPT-Sol. Take into account the vision.md and the different modes and, you know,
> what we're trying to do here, and then really have fun with it.
>
> — Greg, 2026-10-09 (report spya-axbxr8)

## What exists

Spideryarn is an AI-assisted reading app that **augments rather than replaces reading**
(`docs/project/vision.md`). Its wordmark is a small orange spider PNG (`/spideryarn-logo.png`, ~20px,
six legs, radial, drawn as one continuous strand) followed by the word **Spideryarn** in white Geist
600, ten letters, each its own `<span class="logo-letter">`. The spider sits in
`<span class="logo-mark"><img class="logo-image"></span>`.

Fourteen CSS animations already exist (`src/web/styles/logo-animations.css`, registry in
`src/web/logo-animation.ts`, design in `docs/project/design-logo.md`). Do not re-propose these:

| id | reach | what |
| --- | --- | --- |
| settle | mark | spider lifts, leans, overshoots, settles (a transition) |
| pluck | letters | decaying vertical tremble runs S→n |
| sag | letters | row sags in a catenary, springs back |
| register | letters | two coloured ghost plates slide into register (text-shadow) |
| warm | mark | hue drifts warmer, leg-shaped glow breathes |
| seam | letters | word parts Spider \| yarn with a thread across |
| strain | mark | spider hauls at the word, which doesn't budge; letters flush orange |
| i | letters | the i rises one pixel and stays |
| dawn | mark | whole wordmark masked away right-to-left, respun left-to-right |
| type | letters | word dims, types back in, block cursor blinks |
| abseil | letters | the final n drops on a thread and is reeled back |
| dragline | mark | spider drops on a thread, swings, climbs back |
| radius | mark | a lighter band sweeps round the spider like a clock hand (conic gradient masked to the PNG) |
| dew | letters | an orange bead/glow runs once along the white word |

Earlier longlists (about 140 ideas, Sept 2026) are in `docs/plans/260907f-logo-animations-longlist-*.md`
and the shortlist with its near-misses in `docs/plans/260907f-logo-animations-shortlist.md`. Skim them
so you don't just re-propose a near-miss without saying so (re-proposing a near-miss *deliberately*
is fine, say why it deserves another go).

## Where they are seen

1. **Hover / long-press** on the wordmark (corner, reading-view bottom bar, shelf heading, marketing
   bar). Short: the median hover is ~300ms, so it must start instantly. Often the word is hidden and
   only the spider shows — so **mark-only** animations matter.
2. **The article loading screen** (`src/web/LogoLoader.tsx`) — the one Greg loves. The wordmark is
   drawn at 2.2× scale, centred on an empty page, and runs **two tracks at once**: one draws only
   from `reach: mark` animations, the other only from `reach: letters`, each held for whole loops,
   swapping every ~2–3s. So an animation on the loader is seen *beside a partner* on the other half,
   for several seconds. An animation that touches both halves can't be in a track.

## The hard constraints (each has bitten before)

- **Pure CSS on the existing DOM.** Keyframes keyed off a class on the host (`.spya-<name>`), never
  `:hover`. No new elements, no JS per animation, no SVG trace of the spider, no new assets.
- **Touch only one half**: rules reach `.logo-letter` (and its `::before/::after`) *or* `.logo-mark`
  / `.logo-image` (and `.logo-mark::before/::after`), not both — that's what lets it join a loader
  track.
- **Never change a box**: transform, opacity, filter, mask, color, text-shadow, clip-path, and
  absolutely positioned pseudo-elements only. No width/margin/letter-spacing/font-size.
- **Vertical budget is tight**: the reading-view bar is 40px and clips; ~8px of downward travel for
  a letter is the measured ceiling. Horizontal room: a few px.
- **Return to rest at 100%**; a looping keyframe can be cut off at any frame, so stay near rest or
  make the loop end at rest. `animation-fill-mode: forwards` only if the 100% frame is a good still.
- **Letters' resting colour is the token `--wordmark-ink`** (white); the orange is `--highlight` /
  `--highlight-text`. Colours as tokens, never hex.
- **prefers-reduced-motion**: a global guard flattens durations to 0.01ms and iteration count to 1
  (delays and fill modes untouched). The still each one lands on must be a wordmark you'd ship.
- Letter lengths in `calc(var(--logo-px) * N)` (one px of the 13px word); spider lengths in px.
- `--i` (0–9) is available on each letter for staggers. The `font-weight` variable axis (Geist
  100–900) is available on the letters (transform-free, but note: weight changes *do* change glyph
  width → box width. Probably avoid, or prove it doesn't reflow).
- Must not look broken: six missing letters on a nav link is a font failure to a stranger.

## The modes, for the features framing

The reading view's modes (each a lens on the article): Structure (nested table of contents),
Summaries (multi-granularity), Glossary, Ideas (assumed propositions), Quotes, Timeline, Sources
(citations + debate), FAQ, Skim (a route through quotes walked three times at increasing depth),
Search, Referee (helping a peer reviewer), Diagram, Sketch (a picture of the argument), Illustrated,
Reception, Tweets, Comments (bookmark/annotate a passage), Chat, Live conversation (talk to the
article aloud), Learn (say what you took from it and find out), Quiz, Marginalia, Links (hover
cards), Cross-references, Maths, Reading time (where you've spent time down the spine), Granularity
zoom.

## What to write

Your own file, as told. 10–15 ideas in your framing. For each: a **name** (evocative, short), the
**reach** (mark or letters), **what the reader sees** in two or three sentences, **why it's
Spideryarn** (one line), **the CSS mechanism** in a sentence or two (be concrete: which property,
roughly which keyframes), **risk** (what makes it fail or look broken), and whether it suits
**hover, loader or both**. Then finish with your **top 4**, and why. Have fun with it; strangeness is
welcome as long as it is buildable under the constraints.
