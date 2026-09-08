# Longlist: Spideryarn wordmark hover animations — the motion-design schools

One of eight longlists generated on 2026-09-07 against
[260907f-logo-animations-brief.md](260907f-logo-animations-brief.md), which has the DOM, the
constraints and the format. **My framing was to borrow a house style and then apply it to a spider
and ten letters** — every idea below is recognisably *of* a school, and the school is named in its
heading. Each entry therefore carries one bullet the brief did not ask for, **Style discipline**,
which says what the school dictates about timing, easing, palette and — the part that actually
separates a Swiss idea from a glitch idea — *what it refuses to do*. Two ideas from the same school
should look like siblings; two from different schools should disagree about their ease-out curve
before they disagree about their decoration. Eighteen ideas, roughly two per school, ordered by
school and not by quality; three more that I cut are at the foot with the reason. Nothing here is
implemented and nothing outside this file was touched.

## Shared mechanics, so eighteen entries do not each re-derive them

Facts checked in the stylesheets today, referenced by the entries below rather than repeated:

- **The class goes on `.logo`; letters are `.logo.anim-X .logo-letter`.** Never `.logo-text` — the
  dock copy wraps its letters in `.dock-btn-label` instead (brief § The DOM).
- **`.logo-letter` is inline**, so any idea using `transform` must set
  `display: inline-block` itself. A `background`, `color`, `text-shadow` or `opacity` change needs
  no such thing and cannot move the layout, which is why the cheapest ideas here are all of that
  family.
- **Ten stagger delays means ten `:nth-child()` rules.** `sibling-index()` would collapse them to
  one but is Chromium-only; write the ten, it is six lines.
- **Recolouring the spider needs a mask swap, and there is a layout-neutral way to do it.** `.logo`
  is `display: inline-flex; gap: 0.4rem`, so `display: none` on `.logo-image` plus a
  `.logo.anim-X::before { content:''; flex:none; width:20px; height:20px; mask:
  url(/spideryarn-logo.png) center / 20px 20px no-repeat; background: <anything> }` puts a fully
  paintable box in exactly the image's seat in the row and nothing reflows. Cost of that swap alone:
  four lines, plus a one-frame flicker risk at hover-in.
- **Absolute positioning over the wordmark is worse than it looks.** `.logo-home` is
  `padding: 0 0.7rem` and `.dock-home` is `padding: 0 0.6rem`, so any pseudo-element placed by
  coordinates needs two sets of numbers. Prefer flex-item pseudo-elements and per-letter effects.
- **In a narrow dock the ten letters are gone.** `dock-fit-1` and below set
  `.dock-home .dock-btn-label { display: none }`, so every letter-based idea degrades to
  spider-only there. That is fine — it just has to be a deliberate degradation rather than a
  surprise.
- **Every animation must rest at identity.** The global motion guard flattens everything to 0.01ms
  under `prefers-reduced-motion`, so an idea whose beauty is a mid-flight state freezes wrong.
  Checked per entry below.
- **Palette is tokens only** (`--highlight`, `--ink`, `--ink-soft`, `--page`, `--panel`, `--rule`,
  `--rule-strong`, `--highlight-wash`, `--cat-N`, `--heat-N`). Dark ground, unconditionally.

---

## The classical animation principles

The oldest school and the cheapest: no new colour, no new element, nothing but timing. Its whole
claim is that an object with mass moves differently from a `div`.

### 1. The Wind-Up

- **School** — Disney's twelve principles: anticipation, follow-through, slow in / slow out.
- **What the reader sees** — The wordmark compresses very slightly downward, as if gathering
  itself, and then springs up three pixels and settles, each letter starting eighteen milliseconds
  after the one to its left so the motion travels along the word. The spider arrives last, a beat
  behind the final `n`, because it is being dragged along by the word rather than leading it.
- **Why it belongs to this product** — It says the wordmark is a physical object with weight, which
  is what a serious tool's flourish is allowed to say and roughly all it is allowed to say.
- **Mechanism** — `.logo-letter { display: inline-block; transform-origin: 50% 100% }`. One
  `@keyframes sy-windup` with four stops: `0% translateY(0) scaleY(1)`, `18% translateY(1px)
  scaleY(0.94)` (the anticipation, `ease-in`), `52% translateY(-3px) scaleY(1.05)`, `100%`
  identity. 620ms, `animation-timing-function: cubic-bezier(0.34, 1.56, 0.64, 1)` on the release.
  Ten `nth-child` delays at 18ms. The `.logo-image` gets the same keyframe at `animation-delay:
  0.2s` and 70% amplitude.
- **Cost** — Medium (~35 lines: one keyframe, ten delays, the image rule).
- **Style discipline** — Timing is asymmetric on purpose: slow in, fast through, slow out, with the
  anticipation about a third the duration of the release. It refuses colour entirely, refuses any
  second element, and refuses to loop — one gesture, then stillness. Overshoot is capped at 6% or
  it stops being weight and becomes rubber.
- **Risk** — The overshoot. At 1.56 in the bezier it is charming; at 1.9 it is a mobile-game
  splash screen, and the difference is invisible in a spec and obvious on screen.

### 2. Heavy Landing

- **School** — Squash and stretch plus secondary action.
- **What the reader sees** — The spider drops in from a few pixels above, squashes flat on impact
  and re-inflates, and the shock travels outward through the ten letters as a small rising ripple
  that dies out by the final `n`. The letters never move sideways, only up and back, so the word
  stays exactly where it was.
- **Why it belongs to this product** — A spider is the one element of this mark that is an animal,
  and the only animation grammar it truly asks for is *it landed here*.
- **Mechanism** — `.logo.anim-drop .logo-image { transform-origin: 50% 100%; animation:
  sy-land 480ms cubic-bezier(0.22, 1, 0.36, 1) }` with keyframes `0% translateY(-5px) scaleY(1.12)
  scaleX(0.92)`, `55% scaleY(0.82) scaleX(1.14)`, `100%` identity. Letters get `sy-ripple`
  (`translateY(-2px)` at 40%, identity at 100%), 260ms, `nth-child` delays 30ms apart starting at
  200ms so the ripple begins on impact and not before.
- **Cost** — Medium.
- **Style discipline** — Volume is conserved: every `scaleY(0.82)` is paired with a `scaleX(1.14)`,
  which is the whole rule of the school and the thing people skip. Palette: none. It refuses to
  rotate — a landing has an axis.
- **Risk** — The five-pixel drop is a fifth of the mark's height; too much and the spider reads as
  falling off the page rather than landing on it. The vertical budget is ~44px total, and in the
  fixed corner copy there is nothing above to fall from.

---

## Swiss / International typographic

The school of restraint. Motion is permitted only as the *revelation of a structure that was
already there* — never as an event, never as an expression. Linear or near-linear easing, because a
bezier is a mood.

### 3. Baseline Rule

- **School** — Swiss, Müller-Brockmann's grid made visible.
- **What the reader sees** — A one-pixel hairline draws itself from left to right beneath the
  wordmark at a perfectly constant speed, stops flush with the right edge of the final `n`, and
  stays there for as long as the pointer does. Nothing else on the mark moves, brightens or
  changes.
- **Why it belongs to this product** — A reading tool's flourish should look like a measurement,
  and this is literally the baseline the word was set on being pointed out.
- **Mechanism** — `.logo { position: relative }` (already safe; it changes no geometry). `.logo.anim-rule::after { content:''; position:absolute; left:0; right:0; bottom:6px; height:1px;
  background: var(--rule-strong); transform: scaleX(0); transform-origin: left; animation:
  sy-rule 380ms linear forwards }`. One keyframe, `to { transform: scaleX(1) }`. Rests at a drawn
  line, which is a correct still frame.
- **Cost** — Easy (about ten lines).
- **Style discipline** — `linear`, always: acceleration implies feeling. One colour, and it is
  `--rule-strong` rather than `--highlight`, because the brand colour would make the line an
  ornament rather than a datum. It refuses stagger, refuses opacity fades, refuses to touch the
  letters at all, and it refuses to loop — it draws once and holds.
- **Risk** — Being invisible. `--rule-strong` at 1px under 0.82rem type in a corner is very quiet,
  and the honest failure mode is that a reader hovers and cannot tell whether anything happened.
  The `right: 0` also runs the line under `.logo-home`'s 0.7rem padding, so it will over-run the
  `n` unless it is inset.

### 4. Set Solid

- **School** — Swiss, the reveal of the setting.
- **What the reader sees** — All ten letters are stacked flush at the left, overlapping in a single
  dense orange column, and then they slide out to their true positions in one even movement,
  arriving together rather than one at a time. It reads as the word being *set* rather than typed.
- **Why it belongs to this product** — Spideryarn is built on the claim that text has a structure
  under it; this animates the structure and not the text.
- **Mechanism** — Ten `nth-child` rules each with a hard-coded starting `--dx` (the negative of
  that letter's offset from the S, measured once at 0.82rem — same font, same size in both copies,
  so one set of numbers works), `.logo-letter { display: inline-block; animation: sy-set 420ms
  cubic-bezier(0.2, 0, 0, 1) }`, keyframes `from { transform: translateX(var(--dx)) } to
  { transform: none }`. No stagger — the *distances* differ, the timing does not, which is what
  makes it arrive as a set.
- **Cost** — Medium (ten measured constants is the whole cost, and they are brittle if the font
  ever changes).
- **Style discipline** — One duration for all ten, no delays, no overshoot; the easing is a strong
  decelerate with zero bounce, so the letters look placed rather than thrown. Palette untouched. It
  refuses the letter-by-letter stagger that every other school would reach for here, because a
  stagger is a narrative and Swiss does not tell stories.
- **Risk** — The ten measured offsets. Change the brand font or the 0.82rem and the animation
  starts in the wrong place, silently, and only on hover — nothing will catch it.

---

## Terminal, teletype, monospace

Discrete time. `steps()` rather than easing, because a character cell either holds a glyph or does
not. The trap here is that the wordmark is set in `--font-brand` (Trebuchet MS) and switching it to
`--font-mono` would change its width and reflow the dock row — so a terminal idea must borrow the
school's *timing*, not its typeface.

### 5. Waiting Cursor

- **School** — Teletype, and the least any idea in this document does.
- **What the reader sees** — A small solid block appears immediately after the final `n` and blinks
  at the unhurried rate of a shell prompt, on and off, for as long as the pointer rests. Nothing
  else changes at all.
- **Why it belongs to this product** — It says the wordmark is a place where something can be
  entered — a tool, waiting, rather than a badge.
- **Mechanism** — `.logo.anim-caret::after { content:''; width: 0.42em; height: 0.9em;
  background: currentColor; margin-inline-start: 0.12em; margin-inline-end: -0.54em; flex: none;
  animation: sy-blink 1.06s steps(1, end) infinite }`, keyframes `0%,50% { opacity: 1 } 50.01%,100%
  { opacity: 0 }`. The negative end margin cancels its own width so the flex row does not grow.
  Under reduced motion it freezes visible, which is exactly right.
- **Cost** — Easy (eight lines).
- **Style discipline** — `steps(1)`. There is no such thing as a cursor fading; a fade is the one
  thing that would prove nobody in the room had used a terminal. Duration is 1.06s because the
  historical VT100 blink is close to 1Hz and anything faster reads as an error state. One colour,
  `currentColor`, which is already `--highlight`.
- **Risk** — Doing so little that it reads as a rendering bug rather than a flourish — a stray
  orange rectangle beside the logo. Also the negative margin: get the sign wrong and the dock row
  reflows on hover, which is the one thing the brief forbids.

### 6. Retype

- **School** — Teletype, full grammar: type, hold, backspace.
- **What the reader sees** — The ten letters blink out all at once, then reappear one at a time from
  the left at a steady typing cadence with the block cursor advancing ahead of each, and once the
  word is whole the cursor sits and blinks. On a long hover it occasionally backspaces the last
  three letters and types them again, as if reconsidering.
- **Why it belongs to this product** — Typing is the gesture of a working tool, and the "reconsider"
  beat is quietly the app's own thesis: the second pass is where the reading happens.
- **Mechanism** — `.logo-letter { animation: sy-type 40ms steps(1) both }` with `from { opacity: 0
  } to { opacity: 1 }` and ten `nth-child` delays 55ms apart. The cursor is `.logo::after` as in
  idea 5, but instead of a fixed position it rides on `transform: translateX()` through a
  ten-stop `steps(10)` keyframe using the same measured offsets as idea 4. The backspace beat needs
  a second, longer keyframe on a delayed `animation-name` — or, honestly, a few lines of JS, which
  the brief allows for what CSS cannot express.
- **Cost** — Medium without the backspace, Hard with it.
- **Style discipline** — Every timing function is `steps()`; there is no interpolated value
  anywhere in this idea. Cadence is 55ms per character, which is around 200wpm — fast enough to
  feel expert, slow enough to be legible. Refuses transforms on the letters, refuses colour change,
  refuses easing.
- **Risk** — For 550ms the app's own name is incomplete, which on a slow first paint is
  indistinguishable from a broken font load. A reader who hovers over the logo while a page is
  still loading will read it as a failure. Mitigation is to type in from an already-dimmed state
  rather than from nothing.

---

## Glitch, datamosh, CRT

The school with the worst reputation and the best single move. Its discipline is *rarity*: one
short violent event against a stable ground. Applied generously it is a 2015 portfolio; applied
once, briefly, at low amplitude, it is the only school here that can convey *this thing is
processing something*.

### 7. Torn Line

- **School** — CRT horizontal tear / interlace judder.
- **What the reader sees** — For about seventy milliseconds a narrow horizontal band across the
  middle of the wordmark slides three pixels to the right, so the word appears cut and offset, and
  then it snaps back. It happens once, unpredictably, a second or two into the hover, and then not
  again.
- **Why it belongs to this product** — It is the only motion here that suggests the mark is a
  *signal being decoded*, which is what the pipeline behind it actually does to an article.
- **Mechanism** — A duplicate of the word, absolutely positioned over the original, clipped to a
  band: `.logo.anim-tear::after { content: 'Spideryarn'; position: absolute; inset: 0 0 0 <the
  two paddings>; clip-path: inset(42% 0 44% 0); animation: sy-tear 2.4s steps(1) infinite }` with
  the shift living in two frames out of thirty. **This is the one idea that wants markup**: the
  duplicate as a `::after` on `.logo` needs hand-fitted coordinates in both copies and hard-codes
  the word as a content string, so a real implementation should add an `aria-hidden` mirror span
  instead.
- **Cost** — Hard (new markup, or two sets of coordinates).
- **Style discipline** — Amplitude is tiny (3px) and duration is tiny (70ms); the whole school
  lives or dies on the ratio of event to silence, which here is about 1:30. It refuses to loop
  visibly, refuses more than one band, and refuses colour separation — that is idea 9's job and
  doing both at once is the portfolio-site failure exactly.
- **Risk** — **This is one of the two I would tell Greg not to ship.** A tool that a researcher is
  trusting with their reading should not, on hover, imitate a display fault. It reads as "something
  is wrong with this page" for the exact fraction of a second in which the reader has no other
  information, and the cost of that misread is much higher than the charm of the effect.

### 8. Chromatic Split

- **School** — Chromatic aberration, the canonical glitch move.
- **What the reader sees** — Two faint coloured ghosts of the wordmark, one cool and one warm,
  drift a pixel and a half apart from the orange original and then converge back onto it, so the
  word briefly looks like a badly-registered screen and then resolves.
- **Why it belongs to this product** — It says three passes over the same text produce one result,
  which is at least an honest description of the pipeline.
- **Mechanism** — `.logo.anim-split .logo-letter { animation: sy-split 900ms
  cubic-bezier(0.4, 0, 0.2, 1) }` with `text-shadow` interpolated in the keyframes:
  `50% { text-shadow: -1.5px 0 var(--cat-4), 1.5px 0 var(--cat-0) }`, `0%, 100% { text-shadow: 0 0
  transparent }`. `text-shadow` animates smoothly and touches no geometry, so this is the whole
  implementation.
- **Cost** — Easy (twelve lines).
- **Style discipline** — The offsets must be sub-pixel-ish (1.5px at most) and the hues must come
  from the categorical scale rather than pure RGB, because pure red/cyan is the *stock* version of
  this effect and reads as a filter someone downloaded. It refuses displacement, refuses noise,
  refuses scanlines — one channel of the school at a time.
- **Risk** — Cheapness. This is the single most-imitated effect in the last decade of web design,
  and at any amplitude above about 2px it stops being a reference and becomes a cliché. Idea 11 is
  the same visual move with a defensible reason for existing, and if only one of them ships it
  should be that one.

---

## Print and physical media

The school with the strongest claim on a reading tool, because every reference in it is to a made
object that carries text. Its timing is short and its endings are hard — physical processes stop,
they do not ease out to nothing.

### 9. Letterpress

- **School** — Letterpress impression; the mark pressed into the page.
- **What the reader sees** — The wordmark sinks one pixel into the page and gains a hairline of
  shadow above it and a barely-there catch of light below, as if the type had just been struck into
  paper, and it stays pressed for as long as you point at it. Release, and it rises back level over
  about the same time.
- **Why it belongs to this product** — It is the only school that treats the page as a *material*,
  which is the right register for something whose subject is other people's writing.
- **Mechanism** — `.logo.anim-press .logo-letter { display: inline-block; transform:
  translateY(1px); text-shadow: 0 -1px 0 color-mix(in oklab, var(--page) 60%, black), 0 1px 0
  color-mix(in oklab, var(--ink) 8%, transparent); transition: transform 140ms
  cubic-bezier(0.2, 0, 0, 1), text-shadow 140ms }`. A transition, not a keyframe — which means it
  reverses correctly on pointer-out for free and is trivially reduced-motion safe.
- **Cost** — Easy (six lines).
- **Style discipline** — 140ms and done; presses are fast and they *stop*. No loop, no stagger — a
  platen strikes all ten letters at once, and staggering them would be a different and untrue
  physical claim. Palette is the page's own colour darkened, never a new hue.
- **Risk** — On a near-black ground there is very little room below `--page` for the shadow to be
  darker, so the impression can be almost imperceptible. It may need the light-catch below to do
  most of the work, and that is the half that goes muddy fastest.

### 10. Ink Bleed

- **School** — Wet ink into uncoated stock.
- **What the reader sees** — A soft warm halo grows outward from each letter over about half a
  second, spreading further under the heavier strokes than the thin ones, and then holds — the ink
  soaking in and stopping where the fibres stop it. The letters themselves never move.
- **Why it belongs to this product** — The wordmark warming rather than moving is the least
  attention-seeking flourish available, and it lands on the brand colour it already wears.
- **Mechanism** — `.logo.anim-bleed .logo-letter { animation: sy-bleed 540ms
  cubic-bezier(0.16, 1, 0.3, 1) forwards }`, keyframes from `filter: drop-shadow(0 0 0
  transparent)` to `filter: drop-shadow(0 0 2.5px var(--highlight-wash))`, with ten `nth-child`
  delays of 25ms so the bleed travels. Ends at a held glow, which is a legitimate rest state.
- **Cost** — Easy (twelve lines).
- **Style discipline** — Deep ease-out — fast spread, long asymptotic settle, which is what
  capillary action actually looks like. One colour and it must be a *wash* token, not the full
  orange; a saturated halo is a neon sign rather than ink. It refuses movement of any kind, which
  is what separates it from every glow effect on the web.
- **Risk** — `drop-shadow` on ten inline elements is ten filter passes per frame. On a phone in the
  dock this is the most expensive idea in the document for the least visible result, and the honest
  cheaper substitute is a single `drop-shadow` on the wrapper — which loses the per-letter travel
  that is the whole point.

### 11. Misregistration

- **School** — Risograph / two-colour offset, plates out of register.
- **What the reader sees** — Two ghost impressions of the wordmark sit a pixel or two off the
  orange one, in two flat spot colours, and over half a second they slide into perfect register
  and disappear underneath it. The word ends up looking exactly as it started, only now you have
  seen it assembled from plates.
- **Why it belongs to this product** — Registration — several passes over the same text arriving at
  one aligned result — is a better metaphor for what this app does to an article than anything else
  on this list.
- **Mechanism** — Identical to idea 8: `text-shadow` on `.logo-letter`, two offsets, animated to
  `0 0`. The difference is entirely in the direction and the ending — `from { text-shadow: -2px
  -1px 0 var(--cat-2), 1.5px 1.5px 0 var(--cat-9) } to { text-shadow: 0 0 0 transparent }` with
  `cubic-bezier(0.16, 1, 0.3, 1)` and `forwards`. Rests in register, so the reduced-motion still
  frame is the correct wordmark.
- **Cost** — Easy (ten lines).
- **Style discipline** — Riso spot colours are flat, matte and few: two, from the categorical scale,
  at full opacity rather than faded. Movement is always *toward* alignment and never away, which is
  the entire difference between this and a glitch. It refuses blur, refuses jitter, refuses to
  repeat.
- **Risk** — It is one parameter change away from idea 8 and therefore one careless edit away from
  looking like the cliché instead of the reference. Guard it by never letting the animation
  end anywhere but zero.

---

## Scientific instruments

This is a tool for researchers, so instrument aesthetics have a real claim rather than a borrowed
one. The discipline is that an instrument's display *means* something: a trace has an axis, a band
has a position, and motion is always the arrival of data. The failure mode is an instrument that
is measuring nothing, which reads as a prop.

### 12. Trace

- **School** — Oscilloscope / phosphor persistence.
- **What the reader sees** — A thin bright line sweeps left to right under the wordmark at constant
  speed, deflecting into small peaks as it passes under each letter, and the tail of the sweep
  fades behind it like phosphor decaying. When it reaches the end it starts again from the left,
  steadily, for as long as you hover.
- **Why it belongs to this product** — The peaks are under the letters, so the trace is
  measuring *the word* — the mark is reading itself with an instrument, which is the app's job
  description.
- **Mechanism** — Needs a small inline SVG: a `<path>` about 110px wide with ten bumps, `fill:
  none; stroke: var(--highlight); stroke-width: 1`, animated by `stroke-dasharray` /
  `stroke-dashoffset` in the usual self-drawing pattern, with a second copy underneath at lower
  opacity and a longer dash to fake the decay. Absolutely positioned inside `.logo` (two sets of
  coordinates, per the shared notes) or added as a real element next to the wordmark.
- **Cost** — Hard (new markup and a hand-drawn path; ~40 lines including the SVG).
- **Style discipline** — `linear`, without exception: a sweep is a clock, and easing it is a lie
  about the timebase. One colour at two opacities — instruments are monochrome, and a second hue
  would imply a second channel that does not exist. It refuses to bounce, refuses to stop at the
  right-hand end (traces wrap), and refuses to ease in.
- **Risk** — It loops, which the brief warns about: it has to still look right after ten seconds,
  and a repeating sweep in the corner of a reading view is precisely the kind of persistent motion
  that pulls the eye away from prose. It would need to be the slowest thing here, or to run three
  sweeps and stop.

### 13. Chromatography

- **School** — A chromatography strip separating into bands; equally a mass-spec peak list.
- **What the reader sees** — The ten letters drift apart vertically by a pixel or two, each to a
  different height, as if they had different molecular weights and were separating up a strip — and
  then, over a slower second beat, they all return to the baseline. The spread is uneven and
  slightly surprising, which is what makes it read as a measurement rather than a wave.
- **Why it belongs to this product** — Separating one undifferentiated thing into its components is
  what every mode in this app does to an article, and it is a rare case where the metaphor is
  literal rather than decorative.
- **Mechanism** — `.logo-letter { display: inline-block }`, ten `nth-child` rules each setting a
  different `--dy` between `-2px` and `2px`, one keyframe `sy-separate` running `0% translateY(0)`,
  `45% translateY(var(--dy))`, `100% translateY(0)` over 1400ms, `cubic-bezier(0.33, 0, 0.15, 1)`
  going out and a slower return. No stagger — they separate simultaneously, at different rates,
  which is what a chromatogram does.
- **Cost** — Medium (~25 lines, ten of which are the offsets).
- **Style discipline** — The offsets must be *irregular*, not a sine wave — a regular curve is a
  decoration and an irregular set is a reading. Timing is slow and asymmetric: separation is fast,
  re-equilibration is slow. Palette untouched; instruments in this school are colourless.
- **Risk** — Two pixels of vertical scatter on 0.82rem type is very close to "the font is broken".
  There is a narrow band between "this is separating" and "this is misaligned", and it may not
  exist at this size.

---

## Bookbinding, marginalia, the archive

The school of things done *to* a document by a person over time. Its timing is human rather than
mechanical — a hand landing a stamp, a ribbon falling — and its palette is neutrals and stains,
never brand colour. Its risk, uniquely, is semantic: several of its references mean *old*, and this
product is not old.

### 14. Date Stamp

- **School** — The library date stamp on the flyleaf.
- **What the reader sees** — A rectangular outline drops onto the wordmark at a slight angle,
  arriving fast and stopping dead with a tiny recoil, and then fades away over a second leaving
  nothing behind. It lands slightly off-square and slightly off-centre, the way a hand does.
- **Why it belongs to this product** — A date stamp is a record that someone read this, which is
  the closest thing this app has to a unit of value.
- **Mechanism** — `.logo.anim-stamp::after { content:''; position:absolute; inset: 2px 4px;
  border: 1px solid var(--ink-soft); border-radius: 2px; opacity: 0; animation: sy-stamp 1100ms
  cubic-bezier(0.3, 1.4, 0.5, 1) forwards }`, keyframes `0% { transform: rotate(-3deg) scale(1.5);
  opacity: 0 } 22% { transform: rotate(-2deg) scale(1); opacity: 0.75 } 30% { transform:
  rotate(-2deg) scale(0.98) } 100% { opacity: 0 }`. The two paddings problem applies; `inset` is
  the fix if the numbers are tuned per copy.
- **Cost** — Medium (~20 lines, plus tuning in both copies).
- **Style discipline** — The landing is 250ms and the fade is 850ms — a stamp is instant and ink is
  slow, and reversing that ratio is what makes stamp animations look like buttons. The angle must
  be small and *not* a round number. It refuses symmetry and refuses to stay: a stamp that persists
  is a badge.
- **Risk** — A rectangle appearing around the logo is, to anyone who has used software, a focus
  ring. The `.logo-home:focus-visible` rule already draws a 2px `--highlight` outline in almost
  that position, so this idea is actively competing with a real affordance.

### 15. Foxing

- **School** — Foxing: the rust-brown blooms that age brings to paper.
- **What the reader sees** — Two or three faint warm blotches bloom softly behind the wordmark at
  irregular positions, growing over a second and a half and never quite reaching full strength,
  like age spots surfacing on a page. They fade as slowly as they came.
- **Why it belongs to this product** — Honestly, it does not, and that is the point of including
  it: the archive school has a strong pull for a reading tool and this is where following it
  uncritically ends up.
- **Mechanism** — `.logo.anim-fox { background-image: radial-gradient(circle at 22% 60%,
  var(--highlight-wash), transparent 40%), radial-gradient(circle at 71% 35%,
  var(--highlight-wash), transparent 35%); background-size: 200% 200%; animation: sy-fox 3s
  ease-in-out infinite alternate }` animating `opacity` on the whole layer via a wrapper, or
  `background-position` for drift. Background on `.logo` touches no geometry.
- **Cost** — Easy (ten lines).
- **Style discipline** — Very slow, very low contrast, `ease-in-out`, and stains that are never
  circular in a way you can name. It refuses sharp edges and refuses the brand orange at full
  strength.
- **Risk** — **The second of the two I would tell Greg not to ship**, and for a reason that has
  nothing to do with craft. Foxing means *decay*. On the wordmark of a subscription product that a
  researcher is trusting with their library, a hover that makes the logo look mouldy is saying
  something true about paper and something false and unhelpful about the software. Beautiful
  effect, wrong object.

---

## Nature documentary / macro photography

Optical rather than kinetic: the subject does not move, the *lens* does. Very long durations, deep
`ease-in-out`, and a palette that changes only in luminance. The most quietly expensive-looking
school on this list and among the cheapest to build.

### 16. Rack Focus

- **School** — Macro rack focus; the pull between two planes.
- **What the reader sees** — The spider is very slightly out of focus while the word is sharp, and
  then focus pulls across: the spider resolves into crispness as the word softens by a hair, holds
  for a beat, and pulls back. Nothing moves and nothing changes colour — the only variable is what
  is sharp.
- **Why it belongs to this product** — Attention moving from one thing to another, with the
  unattended thing still present and still legible, is exactly the claim in the vision doc about
  augmenting rather than replacing.
- **Mechanism** — `.logo.anim-focus .logo-image { animation: sy-focus-near 2600ms ease-in-out
  infinite alternate }` (`from { filter: blur(0.7px) opacity(0.75) } to { filter: none }`) and
  `.logo.anim-focus .logo-letter { animation: sy-focus-far 2600ms ease-in-out infinite alternate }`
  (`from { filter: none } to { filter: blur(0.45px) opacity(0.8) }`). Two rules, one duration, no
  stagger, no coordinates. Reduced motion freezes at frame one, which is the mark's normal
  appearance.
- **Cost** — Easy (eight lines).
- **Style discipline** — 2.6 seconds per pull, `ease-in-out`, because a focus puller's hand
  accelerates and decelerates and a linear pull is unmistakably mechanical. Blur is under a pixel:
  above that it is not shallow depth of field, it is a smudge. It refuses transform, refuses hue,
  refuses stagger. **A slow-push variant** — the whole `.logo` scaling 1 → 1.025 over four seconds,
  three lines — belongs to the same school and can be combined or shipped alone.
- **Risk** — Blurring 0.82rem text is blurring the product's name, and on a low-DPI screen a 0.45px
  blur on small type does not read as "defocused", it reads as "badly rendered". The spider half is
  safe; the letters half needs looking at on a real 1× display before anyone believes it.

---

## Japanese design

Two nearly opposite disciplines under one heading: the single decisive stroke, and *ma* — the
interval, where the meaning is in what does not happen. Both refuse ornament, and both are
much harder to get right than they are to describe.

### 17. One Stroke

- **School** — The single brush stroke; one gesture, no correction.
- **What the reader sees** — A single tapered line sweeps beneath all ten letters in one
  unhesitating movement, thick where the brush lands and thinning to nothing as it lifts away past
  the final `n`. It draws once, in under half a second, and then it simply stays.
- **Why it belongs to this product** — It is the same object as idea 3's Swiss baseline, drawn by a
  hand instead of a ruler, and having both in the shortlist would let Greg choose which of those
  two the product is.
- **Mechanism** — `.logo.anim-stroke::after { content:''; position:absolute; left:0; right:0;
  bottom:5px; height:2px; background: var(--highlight); mask-image: linear-gradient(to right,
  rgba(0,0,0,1) 0%, rgba(0,0,0,1) 70%, rgba(0,0,0,0) 100%); transform: scaleX(0); transform-origin:
  left; animation: sy-stroke 460ms cubic-bezier(0.16, 1, 0.3, 1) forwards }`. The mask does the
  taper; a second, subtler `mask` stop at the left end gives the brush its landing.
- **Cost** — Easy to Medium (fifteen lines, most of them the mask).
- **Style discipline** — One movement, decelerating hard — a brush stroke is fastest at the start
  and the ink runs out at the end, which is the exact opposite of the Swiss rule's constant speed
  and is the entire difference between ideas 3 and 17. One colour, the brand orange, at full
  strength. It refuses a second stroke, refuses to repeat, refuses to be straight-ended.
- **Risk** — At 2px under 0.82rem type, a tapered stroke and an underline are the same object, and
  the taper is the only thing carrying the idea. If the mask gradient is too gentle it is just a
  hover underline, which is the most generic thing on the web.

### 18. Held Breath

- **School** — *Ma*: the interval, and the refusal to fill it.
- **What the reader sees** — You hover, and for a beat nothing happens at all — long enough that
  you notice nothing is happening — and then the wordmark settles by a single pixel and brightens
  almost imperceptibly, and that is the whole animation. It is over before you have decided whether
  it was.
- **Why it belongs to this product** — The vision doc's whole argument is against making things too
  easy and too quick; an animation whose content is a pause is the only idea in this document that
  agrees with it structurally rather than thematically.
- **Mechanism** — `.logo.anim-ma .logo-letter { display: inline-block; animation: sy-ma 260ms
  cubic-bezier(0.2, 0, 0, 1) 520ms both }` — the 520ms delay *is* the idea — with keyframes `from
  { transform: translateY(0); opacity: 0.85 } to { transform: translateY(-1px); opacity: 1 }`.
  Three lines and one number.
- **Cost** — Easy (five lines).
- **Style discipline** — The delay is longer than the motion, by two to one. Amplitude is one
  pixel and one step of opacity — anything more and the pause reads as lag rather than as
  restraint. It refuses every other property in this document.
- **Risk** — It is indistinguishable from a slow stylesheet. A reader who hovers and sees a
  half-second of nothing has learned that the logo is unresponsive, and no amount of intent in the
  design doc reaches them. This is the one idea whose success depends entirely on it being *one*
  of a random set — surrounded by fifteen animations that respond instantly, a pause is a joke; on
  its own it is a bug.

---

## Kinetic typography

Type as the actor rather than the surface. The discipline here is that the motion must be *about
the words* — a wordmark that moves for reasons unrelated to what it says is animation, not kinetic
typography.

### 19. Reads Itself

- **School** — Kinetic typography, the text performing its own meaning.
- **What the reader sees** — A soft warm wash slides letter by letter along the word at a plausible
  reading speed, one letter lit at a time with a short tail behind it, reaching the final `n` and
  then leaving. It looks precisely like the highlight the app draws on prose when it is tracking
  where you are.
- **Why it belongs to this product** — It is the app's own reading mark, applied to the app's own
  name, and it is the only idea here that a reader would recognise from elsewhere in the product.
- **Mechanism** — `.logo-letter { animation: sy-read 1600ms ease-in-out infinite }` with `0%,
  100% { background-color: transparent } 12% { background-color: var(--highlight-wash) }` and ten
  `nth-child` delays at 90ms. `background-color` on inline elements is layout-free, and the wash
  token is the same one the prose uses. **A sibling idea from the same school**, worth a slot of its
  own if there is room: *Two Words* — "Spider" holding at `--highlight` while "yarn" dims to
  `--ink-soft` and then the two trade, which is the compound name showing you it is a compound.
  Same mechanism, four `nth-child` rules instead of ten.
- **Cost** — Easy (twelve lines).
- **Style discipline** — Cadence must be a *reading* cadence, ~90ms per letter, not an animation
  cadence — too fast and it is a shimmer sweep, which is what the previous version already built
  and what this must not become. The wash is the product's own token at the product's own opacity,
  and it refuses any other colour on principle: the moment it invents a hue it stops being the
  reading mark and becomes decoration.
- **Risk** — It loops, and it loops in the reader's peripheral vision while they are reading prose
  eighty pixels away. It also sits one small parameter change from the old app's "Highlight Sweep",
  which the brief explicitly warns against re-listing — the defence is that this is per-letter and
  uses the real prose token, and if that distinction is not visible on screen then it is the same
  animation and should be dropped.

---

## Three I cut, and why

Kept here because the reason is the useful part.

- **Ribbon Marker** (bookbinding) — a `--highlight` ribbon dropping from the top edge and swinging
  to rest. Killed by geometry, not taste: the control is ~44px tall and `.logo-home` is
  `position: fixed` at the very top of the window, so there is nowhere for a ribbon to fall *from*
  and anything that overflows lands on real content at z-index 60.
- **Kintsugi** (Japanese) — a hairline crack across one letter, filling with a lighter gold. It
  needs `background-clip: text` and a per-letter gradient, so it is Hard; but the real objection is
  the same as Foxing's. Kintsugi is beautiful *because* the object was broken, and a wordmark
  should not tell you it was broken and mended.
- **Phosphor Decay** (CRT) — letters flaring to near-white and decaying back to orange with a long
  green-ish tail. Cut because the green is the whole reference and the green is not in the palette;
  done in `--highlight` it is a glow pulse, which the previous version already had ("Warm Glow
  Pulse") and which the brief rules out re-listing.

## What the eighteen say collectively

Two things worth carrying into the prioritisation pass:

- **The cheapest schools are the best ones here.** Letterpress, Rack Focus, Misregistration, One
  Stroke, Held Breath and Baseline Rule are all under fifteen lines and none of them needs new
  markup, a coordinate, or a measured font offset. The three Hard ideas — Trace, Torn Line, Retype
  with the backspace — are also the three most likely to look like something is wrong.
- **The judgement the brief asked for lands in one place.** The ideas I would keep away from a tool
  aimed at researchers are the ones that imitate a *fault* (Torn Line), imitate *decay* (Foxing,
  and Kintsugi from the cut list), or imitate *unresponsiveness* (Held Breath, unless it is one of
  many). Everything else on this list is safe; the question for the rest is only whether it is
  interesting.
