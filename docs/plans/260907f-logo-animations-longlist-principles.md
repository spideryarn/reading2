# Longlist: logo animations from the product's principles

One of eight parallel longlists generated on 2026-09-07 against
[260907f-logo-animations-brief.md](260907f-logo-animations-brief.md). **This agent's framing was
the product's own argument about reading**: every idea here is an eight-second claim about a
commitment in [vision.md](../project/vision.md) or [README.md](../../README.md) — augmentation
rather than replacement, the text as destination, the citation that always lands, descent on demand,
difficulty deliberately preserved, the dog-eared book with a clever friend's marginalia, and the
four named anti-goals. The test applied to each was: *if a researcher hovered this and thought about
it for half a second, what would they have absorbed about the product?* Ideas whose only virtue was
prettiness were dropped; ideas whose meaning lands a beat after the motion were kept even where the
motion is nearly nothing. Nothing here is implemented, and no other file was touched.

Two constraints shaped every mechanism below, from the brief: **select on `.logo-letter` and
`.logo-image`, never `.logo-text`** (the dock copy wraps its letters in `.dock-btn-label` instead),
and **every animation must be safe frozen at frame one**, because the global
`prefers-reduced-motion` guard flattens duration to 0.01ms rather than suppressing the animation. So
every keyframe set below either starts at rest or is written so that the *first* frame is the
finished, correct state.

---

## 1. Legible, Not Less

- **Name** — Legible, Not Less
- **What the reader sees** — On hover the wordmark does not move, brighten, or sweep; it simply gets
  *sharper*. A soft one-pixel ghost that has been sitting behind the letters all along contracts to
  nothing, and the orange settles a shade deeper, so the word reads as if it had been slightly out
  of focus until you looked at it.
- **Why it belongs to this product** — It is the whole argument in one gesture: the AI arrived and
  the author's words became **more** legible, not fewer — *"Every generated line should be a door,
  not a wall"* (vision.md § Principles).
- **Mechanism** — `.logo-letter { position: relative; display: inline-block; }` with a duplicate
  drawn by `.logo-letter::before { content: ""; }`? No — cheaper and text-safe: put a
  `text-shadow: 0 0 1.5px var(--highlight)` halo on `.logo-letter` at rest and transition it to
  `0 0 0 transparent` on `.logo:hover .logo-letter`, alongside `color: var(--highlight)` →
  `var(--highlight-ink)`. Add `filter: blur(0.3px)` → `blur(0)` on `.logo-image` for the same beat.
  No keyframes at all — two transitions.
- **Cost** — Easy (a dozen lines).
- **Risk** — It is so subtle that on a low-DPI screen nobody notices anything happened, and it reads
  as "the hover is broken". The blur at rest also costs a hair of legibility on the *un*-hovered
  logo, which is the state 99% of readers see — a self-inflicted wound in service of a joke about
  focus.

## 2. The Dog-Ear

- **Name** — The Dog-Ear
- **What the reader sees** — The top-right corner of the wordmark's invisible box folds over, as a
  small triangle of page-coloured paper laid across a thin rule, exactly like the corner of a book
  page turned down to keep a place. It folds in 180ms and stays folded for as long as the pointer
  rests; when you leave, it unfolds.
- **Why it belongs to this product** — It is the README's own image, made literal: *"like reading a
  dog-eared copy of a book where a clever friend has highlighted the best bits and scribbled in the
  margins"*.
- **Mechanism** — `.logo { position: relative; }` and a `::after` at `top: 0; right: -2px;
  width: 8px; height: 8px;` painted with
  `background: linear-gradient(225deg, var(--panel) 50%, transparent 50%)` and a
  `border-left/bottom: 1px solid var(--rule)`, `transform: scale(0)` with
  `transform-origin: top right`, transitioning to `scale(1)` on `.logo:hover`. Pure transition, no
  keyframes, so the reduced-motion resting state is `scale(0)` — invisible and correct.
- **Cost** — Easy.
- **Risk** — At 8px on a corner that already sits under a `--safe-top` inset, it may read as a
  rendering artefact or a stray triangle rather than a folded page; and the fold needs the page
  colour behind it, which differs between the fixed corner (`--page`) and the dock (`--panel`).

## 3. Yarn Out, Yarn Back

- **Name** — Yarn Out, Yarn Back
- **What the reader sees** — A single hairline of orange unspools from the spider's knot and runs
  along the baseline beneath the ten letters, left to right, as one continuous thread; it pauses at
  the `n`, then winds back into the body it came from. The loop repeats slowly while you hover.
- **Why it belongs to this product** — The name's own origin, kept because it stayed true: *"a web
  of ideas and stories weaving together"* (Greg, 2026-09-02, positioning.md § The name) — and the
  thread going **back** to its source is the citation commitment in miniature.
- **Mechanism** — `.logo::after` positioned `left: 24px; right: 0; bottom: 6px; height: 1px;
  background: var(--highlight);` with `transform: scaleX(0); transform-origin: left center;`.
  Keyframes `0% scaleX(0) origin-left → 45% scaleX(1) → 55% scaleX(1) origin-right → 100% scaleX(0)`
  (two rules, or `animation-direction: alternate` with a delay). First frame is `scaleX(0)` —
  invisible at rest.
- **Cost** — Easy.
- **Risk** — A thin line under a word is an underline, and an underline under a link that already
  underlines on hover is noise. It also reads as a loading bar if the timing is even slightly
  mechanical.

## 4. Marginalia

- **Name** — Marginalia
- **What the reader sees** — A wobbly, hand-drawn pencil line scribbles itself under three or four
  of the letters — not a straight rule, a slightly-off, twice-gone-over graphite stroke of the kind
  somebody makes in a book they own. It draws in about 400ms and rests there, faintly, until you
  move away.
- **Why it belongs to this product** — Annotation, not summary: the mark of a reader who has been
  here before, which is what every mode in the band is doing to the prose.
- **Mechanism** — `.logo::after` as in #3, but the background is a repeating SVG data-URI of a hand
  drawn squiggle in `currentColor`, tinted `color: var(--ink-faint)`, and the reveal is a
  `mask-image: linear-gradient(90deg, #000 0 0)` whose `mask-size` animates `0% 100%` → `100% 100%`
  so it *draws* rather than fades. A second, shorter stroke at a 1.5° `rotate` gives the
  gone-over-twice look.
- **Cost** — Medium (30–60 lines, plus hand-authoring one squiggle path).
- **Risk** — Hand-drawn assets look charming at 200px and look like a smudge at 90px wide; pencil
  grey against `--ink-faint` in dark theme can vanish entirely, and a squiggle that repeats
  identically on every hover stops reading as handwriting by the third time.

## 5. The Sweep That Returns

- **Name** — The Sweep That Returns
- **What the reader sees** — A band of highlight wash travels across the ten letters left to right,
  the familiar marker-pen sweep — and then, instead of running off the right edge, it *reverses* and
  contracts, narrowing until it is a single lit letter that stays lit. Every pass ends by pointing
  at one thing.
- **Why it belongs to this product** — It is the deliberate sharpening of the previous version's
  Highlight Sweep, and the difference is the whole point: *"When the AI says what the article says,
  it cites the passage… Nothing it asserts is left unanchored"* (README). The old sweep left; this
  one lands.
- **Mechanism** — An absolutely-positioned `.logo::before` inset over the letters, filled with
  `var(--highlight-wash)`, `mix-blend-mode: multiply` (light) / `screen` (dark), and clipped by an
  animated `clip-path: inset(0 A 0 B)`. Keyframes drive `A`/`B` together to sweep, then converge on
  the same ~10% window and hold. `border-radius: 2px` on the clip window keeps it marker-shaped.
  Rests at `inset(0 100% 0 0)` — nothing painted.
- **Cost** — Medium.
- **Risk** — Which letter it lands on is arbitrary, and an arbitrary highlight looks like a bug
  rather than a citation; landing on the same letter every time makes the meaning legible but the
  motion stale. `mix-blend-mode` over the fixed corner logo can also pick up whatever page content
  is behind it.

## 6. Anchor Drop

- **Name** — Anchor Drop
- **What the reader sees** — A tiny orange caret falls from the spider's body, arcs down and to the
  right, and plants itself under one letter; a hairline then draws back from the caret to the spider,
  so the mark and its source are visibly joined. Then it fades and does it again, to a different
  letter.
- **Why it belongs to this product** — Legible provenance as a physical act: *"Anything the model
  asserts is anchored to a block id, and the reader can always reach the passage it came from in one
  action"* (vision.md § Principles 4).
- **Mechanism** — Two pseudo-elements. `.logo::before` is a 3px triangle (`clip-path: polygon`)
  animated along a path with `translate` + `offset-path: path(...)` (or just staggered
  `translate3d` keyframes if `offset-path` is too much). `.logo::after` is the connecting hairline,
  `height: 1px`, `transform-origin: left`, `scaleX` 0→1 after the caret lands, `background:
  var(--rule-strong)`. `.logo-letter:nth-child(n)` picks the target letter by hard-coded offsets.
- **Cost** — Medium, or Hard if the target letter is randomised in JS rather than fixed in CSS.
- **Risk** — Two moving parts in 120×44px is crowded, and a caret plus a line at this size can read
  as a dropped glyph or a text-cursor artefact. The connecting line is also the first thing to look
  cheap if its timing is off by 50ms.

## 7. Provenance Freckles

- **Name** — Provenance Freckles
- **What the reader sees** — A small dot appears beneath each of the ten letters in quick sequence,
  like ten footnote markers being laid down. A half-second later nine of them fade out and the
  survivor widens into a short underline under a single letter, which is the only mark left when the
  motion settles.
- **Why it belongs to this product** — Ten claims, one of them checkable right now: the visual form
  of *"one press and you are reading the author, not the model"* (README).
- **Mechanism** — `.logo-letter { display: inline-block; position: relative; }` and
  `.logo-letter::after { content: ""; position: absolute; left: 50%; bottom: -3px; width: 2px;
  height: 2px; border-radius: 50%; background: var(--highlight); opacity: 0; }` with a keyframe
  `dot-in` and `animation-delay: calc(var(--i) * 40ms)` — the index needs either
  `:nth-child(1..10)` rules (ten lines) or a `--i` custom property set in the JSX. The survivor is
  one extra `:nth-child(6)` rule with a different keyframe that scales `width` to 6px.
- **Cost** — Medium.
- **Risk** — Ten dots under a 0.82rem word is a lot of small detail; on a non-retina display they
  half-disappear, and if the survivor lands on a letter with a descender (`p`, `y`) it collides.

## 8. Drop In

- **Name** — Drop In
- **What the reader sees** — Three faint ghost copies of the word are stacked a few pixels above the
  real one, each fainter than the last, like the same sentence seen from three altitudes. They
  descend and collapse into the solid wordmark, which brightens as they arrive — and once they have
  arrived, the ghosts are gone and only the real thing remains.
- **Why it belongs to this product** — Granularity zoom as a single gesture: *"Scan the landscape
  quickly. Descend on demand into the actual prose"* — and the arrival is at the **verbatim** level,
  because *"the rightmost level is verbatim, always"* (vision.md § Principles 5).
- **Mechanism** — Needs a duplicate of the letter run. Cheapest honest version: two absolutely
  positioned `.logo::before` / `::after` elements carrying `content: "Spideryarn"` in
  `var(--font-brand)`, `color: var(--ink-faint)`, offset `translateY(-8px)` / `-4px` and
  `opacity: .35 / .55`, animating to `translateY(0)` and `opacity: 0`. Requires the same font-size
  and `letter-spacing: 0.02em` as `.logo-letter` so the ghosts register with the real word.
- **Cost** — Medium (Hard if a proper three-copy stack with real markup is wanted).
- **Risk** — `content` text duplicates the word for screen readers unless `aria-hidden` machinery is
  right (pseudo-element content is inconsistently announced), and eight pixels of upward travel in a
  fixed corner element at `--safe-top` may clip. It can also read as a drop-shadow glitch rather
  than three altitudes.

## 9. Weight Wave

- **Name** — Weight Wave
- **What the reader sees** — A wave of *thickness* travels through the word: each letter in turn
  gets heavier and then relaxes, so the emphasis rolls from `S` to `n` like a finger tracing the
  line. Nothing moves; the word simply breathes weight from left to right.
- **Why it belongs to this product** — Detail where you are and sparseness elsewhere — the semantic
  fisheye that Outline mode is (`column-context.md`), applied to ten letters instead of a table of
  contents.
- **Mechanism** — **Not** `font-weight` or `font-variation-settings`, both of which change advance
  width and would reflow the dock's flex row. Fake it:
  `.logo:hover .logo-letter { animation: weight-wave 1.6s ease-in-out infinite; }` where the
  keyframe moves `text-shadow: 0 0 0 currentColor` → `0 0 0.5px currentColor` →
  `0.3px 0 0 currentColor` and back, with `animation-delay: calc(var(--i) * 60ms)`.
  `text-shadow` is zero-cost to layout.
- **Cost** — Easy to Medium (the per-letter delay is the only real work).
- **Risk** — Faked weight via text-shadow looks like a rendering smear at small sizes, especially on
  a light-on-dark theme where the halo blooms. Ten `nth-child` delay rules is also the exact kind of
  bloat that turned the previous version's playground into 1,911 lines of CSS.

## 10. Two Columns

- **Name** — Two Columns
- **What the reader sees** — A hairline appears mid-word, and the letters on one side of it go quiet
  in a faint ink while the other side stays full orange. The line slides across, and as it passes
  each letter, that letter hands over: the quiet side is always the side you are not on.
- **Why it belongs to this product** — The reading view's actual shape — the gist beside the prose,
  the band beside the text — and the fact that both are always present, which is *"the full text is
  always there beside whatever the model produced"* (README).
- **Mechanism** — `.logo::before` is the 1px `var(--rule-strong)` divider, `left: 0`, animated with
  `transform: translateX(0 → 100px)` over the word's width. The colour handover is per-letter:
  `.logo:hover .logo-letter { animation: handover 2.4s linear infinite; animation-delay:
  calc(var(--i) * 240ms); }` where `handover` steps `color` from `var(--ink-faint)` to
  `var(--highlight)` at a single stop, so the change is a hard cut rather than a fade and reads as a
  boundary crossing.
- **Cost** — Medium.
- **Risk** — A vertical line sliding through a word at 20px height is nearly invisible; and getting
  the divider's travel to stay in sync with ten stepped colour changes across two different DOM
  shapes (the corner copy and the dock copy have different available widths under the fit ladder) is
  where this quietly goes wrong.

## 11. Full Text Beneath

- **Name** — Full Text Beneath
- **What the reader sees** — Behind the wordmark, a small block of grey ruled lines fades up — six or
  seven one-pixel bars of varying length, unmistakably a paragraph of prose seen from far away. The
  letters stay fully bright on top of it, and the paragraph never covers them; it arrives *beside*
  them and then quietly fades.
- **Why it belongs to this product** — The first principle, drawn rather than stated: *"The text is
  the destination, not the source material"*, and the generated thing never sits in front of it.
- **Mechanism** — `.logo::before` behind the letters (`z-index: -1`, `.logo { isolation: isolate }`)
  filled with `repeating-linear-gradient(to bottom, var(--rule) 0 1px, transparent 1px 4px)` and a
  `mask-image: linear-gradient(90deg, #000 70%, transparent)` plus a slight per-row width variance
  faked by a second overlaid gradient. Animate `opacity: 0 → 0.6 → 0.25`.
- **Cost** — Medium.
- **Risk** — Ruled grey lines behind text is exactly what a skeleton loading placeholder looks like,
  so the first read is "the page hasn't finished loading". It also fights the corner logo's
  transparent background over arbitrary page content.

## 12. Question in the Margin

- **Name** — Question in the Margin
- **What the reader sees** — A small, faint question mark fades in just above and left of the word,
  hangs for a beat as if somebody were deciding whether to ask, and then a hairline draws from it
  down to a letter — as though the question had found the exact place it belonged.
- **Why it belongs to this product** — *"Ask questions of the text at the point of confusion, in
  place"* (vision.md § What we want instead), and the confusion signal that vision.md calls *"the
  highest-value input we can get"*.
- **Mechanism** — `.logo::before { content: "?"; font-family: var(--font-brand); font-size: 0.7rem;
  color: var(--ink-faint); position: absolute; top: -2px; left: 14px; opacity: 0;
  transform: translateY(3px); }` animating to `opacity: 1; translateY(0)`, then `.logo::after` as a
  1px `var(--rule)` connector with `transform-origin: top` and `scaleY(0 → 1)` on a delay.
- **Cost** — Easy to Medium.
- **Risk** — A question mark next to a logo reads as a help affordance, and a reader may click
  expecting documentation. Vertical room above the word is the tightest dimension in the whole
  control.

## 13. Nothing Rewritten

- **Name** — Nothing Rewritten
- **What the reader sees** — For a fraction of a second, the letters look as though they are about to
  become *different* letters — they blur, shear a half-degree, the word almost turns into some other
  word — and then they snap back, hard, to exactly what they were. The whole thing takes 250ms and
  ends with the wordmark unmistakably unchanged.
- **Why it belongs to this product** — It animates a refusal: *"We never silently rewrite the
  author's prose in the reading view"* (vision.md § Principles 5). Every other product's logo
  scramble-effect says "watch me generate"; this one says the opposite, and that is the surprise.
- **Mechanism** — CSS-only version (Medium): `.logo:hover .logo-letter { animation: almost 260ms
  cubic-bezier(.2,.9,.1,1) both; animation-delay: calc(var(--i) * 15ms); }` with keyframes
  `0% { filter: none } 35% { filter: blur(1.2px); transform: skewX(-4deg) scaleY(1.06) }
  100% { filter: none; transform: none }`. Truer version (Hard): JS swaps each `.logo-letter`'s text
  for a random glyph for two frames and restores it — which is the only way the "different word" is
  actually legible, and needs the original letter cached so an interrupted hover cannot leave the
  wrong glyph on screen.
- **Cost** — Medium (CSS) / Hard (JS glyph swap).
- **Risk** — The JS version can strand a wrong letter if the pointer leaves mid-animation — the
  brand, misspelt, permanently. And a blur-and-shear that reads as "font failed to load" is a much
  worse first impression than no animation at all.

## 14. What Compression Costs

- **Name** — What Compression Costs
- **What the reader sees** — Six of the ten letters fade out, leaving a gap-toothed remnant that you
  can *almost* read — the word compressed to its "key points". It sits there just long enough to be
  uncomfortable, and then every missing letter fades back in and the word is whole again.
- **Why it belongs to this product** — It is the two-minute summary, shown and then withdrawn:
  *"a fluent impression of the piece and none of its texture, no argument you could reconstruct, no
  sentence you could quote"* (README § The problem, and the bet).
- **Mechanism** — Only opacity, so nothing reflows: `.logo:hover .logo-letter:nth-child(2),
  :nth-child(4), :nth-child(5), :nth-child(7), :nth-child(8), :nth-child(10) { animation: drop-out
  1.8s ease-in-out infinite; }` with keyframes `0%,15% { opacity: 1 } 40%,60% { opacity: .12 }
  85%,100% { opacity: 1 }`. First frame is `opacity: 1`, so the reduced-motion freeze shows the
  complete word — which is exactly the right resting state for this idea.
- **Cost** — Easy.
- **Risk** — Letters winking out is the single most common way a logo animation looks broken rather
  than intentional, and a reader who does not get the joke will read it as a font-loading failure.
  It also risks looking like the app is deleting things.

## 15. The Gym Rep

- **Name** — The Gym Rep
- **What the reader sees** — The whole word does one slow, effortful rep: it sinks a pixel, holds at
  the bottom slightly too long, and then presses back up with a visible fight in the timing —
  slowest at the hardest point, quick at the top. Not a bounce; a lift.
- **Why it belongs to this product** — Greg's own metaphor, animated: *"you can go to the gym or you
  can buy a forklift truck to lift the weights. But if you buy the forklift truck that lifts the
  weights, then you atrophy"* (Greg, dictated notes, 2026-09). A logo that visibly does work is the
  anti-forklift.
- **Mechanism** — `.logo:hover .logo-letter { display: inline-block; animation: rep 2s
  cubic-bezier(.85,0,.15,1) infinite; animation-delay: calc(var(--i) * 25ms); }` with keyframes
  `0% translateY(0) → 25% translateY(1px) → 55% translateY(1px) → 80% translateY(-0.5px) →
  100% translateY(0)`. The whole idea lives in the easing curve, not the distance; a symmetric
  `ease-in-out` destroys it.
- **Cost** — Easy.
- **Risk** — One pixel of travel is not enough to read as effort, and two pixels is enough to look
  like the text is wobbling. The meaning is entirely carried by timing, which is the thing most
  likely to be "tidied up" by a later editor into something effortless — at which point it says the
  opposite of what it meant.

## 16. The Spider Strains

- **Name** — The Spider Strains
- **What the reader sees** — The spider leans hard to the left, legs braced, as if trying to haul the
  word off the screen — and the word does not budge. After a beat it gives up, springs back upright,
  and the letters brighten a shade, as though acknowledging they were never going anywhere.
- **Why it belongs to this product** — The forklift refused, in the other direction: the machine
  strains, the text stays. *"a companion, not a replacement"* (README) is funnier and more memorable
  as a failed abduction than as a slogan.
- **Mechanism** — `.logo:hover .logo-image { animation: strain 1.6s ease-in-out infinite; }` with
  keyframes `0% { transform: none } 45% { transform: translateX(-2px) rotate(-8deg) scaleX(1.08) }
  60% { transform: translateX(-2px) rotate(-8deg) } 75% { transform: rotate(4deg) }
  100% { transform: none }` — the `scaleX` stretch is what sells the effort. Pair with a
  `.logo:hover .logo-letter { color: var(--highlight-ink); transition: color 1s .8s; }`.
- **Cost** — Easy.
- **Risk** — Anthropomorphising a 20px silhouette with six legs and no interior detail is a coin
  flip: at this size the lean may just read as the icon being crooked, which looks like a CSS bug
  rather than a character beat. It is also the idea most likely to feel cute in a product whose
  voice is *"confident and plain"* (positioning.md § Whose words).

## 17. Two Minutes, Refused

- **Name** — Two Minutes, Refused
- **What the reader sees** — A thin arc begins sweeping clockwise around the spider, unmistakably a
  timer starting to count. It gets about a third of the way round, stalls, and dissolves — and in the
  moment it dies, the ten letters light up in sequence, left to right, as if the time it was counting
  had been given back to the reading instead.
- **Why it belongs to this product** — A named anti-goal, animated as its own refusal:
  *"Read this in 2 minutes"* and *"anything optimising for time-in-app"* (vision.md § Anti-goals).
- **Mechanism** — `@property --sy-arc { syntax: "<angle>"; inherits: false; initial-value: 0deg; }`,
  then `.logo::before` sized over the image with
  `background: conic-gradient(var(--highlight) var(--sy-arc), transparent 0)` and a
  `mask: radial-gradient(closest-side, transparent 72%, #000 74%)` to make it a ring. Keyframes take
  `--sy-arc` `0deg → 120deg` while `opacity` goes `1 → 0`; a second animation on
  `.logo-letter` runs `color: var(--ink-faint) → var(--highlight)` on staggered delays after it.
- **Cost** — Medium (Hard in any browser without `@property`, where the arc has to be faked with a
  rotating half-disc mask).
- **Risk** — This is a spinner. For the first 400ms every reader's brain says "loading", and a
  product whose logo appears to be loading is a product that appears slow — the exact opposite of the
  claim. The refusal only lands if you were already thinking about it.

## 18. The Friend's Tick

- **Name** — The Friend's Tick
- **What the reader sees** — A small pencil tick draws itself in the space to the right of the word,
  in two strokes — the short down-stroke first, then the long up-stroke — the way a person actually
  makes a check mark in a margin. It rests there, faintly, and rubs out when you leave.
- **Why it belongs to this product** — The clever friend has read this and left a mark: not a
  verdict, not a score, just evidence that somebody who understood it was here — *"scribbled in the
  margins to help with the difficult bits"* (README).
- **Mechanism** — Needs an inline SVG (roughly 15 lines, `stroke: currentColor`,
  `stroke-linecap: round`) in `HomeLogo.tsx` **and** `Dock.tsx`, absolutely positioned and
  `aria-hidden`, drawn with `stroke-dasharray` / `stroke-dashoffset` animated to 0 on
  `.logo:hover`. Two `<path>` elements with staggered delays give the two-stroke feel.
  Rests at `stroke-dashoffset: 100%` — nothing drawn.
- **Cost** — Hard (new markup in two components, kept in sync — the brief's own warning about a
  second copy of the mark applies).
- **Risk** — A tick is a *judgement*, and a reading tool that appears to be grading the article is
  saying something the product deliberately does not say. It also needs horizontal room the dock's
  fit ladder may not have, and duplicated SVG in two components is the seed of the drift the brief
  warns about.

---

## What was deliberately not proposed

Three shapes were generated and dropped, recorded so a later pass does not regenerate them:

- **A progress bar filling to 100%.** Completion is an engagement mechanic and the anti-goal list
  names them; the same objection kills any streak, counter or badge.
- **Letters rearranging into a shorter word.** It says compression is clever. #14 exists to say the
  opposite, and having both would be incoherent.
- **A chat bubble emerging from the spider.** *"It is a reading tool, not a writing or chat tool"*
  (README), and chat is placed *"far down"* on the website for exactly this reason
  (positioning.md § Chat, on the site). Putting it in the logo would invert the positioning.
