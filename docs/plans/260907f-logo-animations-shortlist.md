# Shortlist: the thirteen wordmark animations to build

The arbitration over the eight longlists written against
[260907f-logo-animations-brief.md](260907f-logo-animations-brief.md) — roughly 140 ideas, of which
thirteen are picked below **as a set**, in build order, with the numbers an implementer needs.
Fable, 2026-09-07. Nothing here is implemented; the only file this pass wrote is this one.

> use Fable to prioritise them by a combination of **ease and value and diversity**, then pick the
> top dozen or so.
>
> — Greg, 2026-09-07

## How this was decided

Three axes, and they pointed different ways often enough that it is worth saying where.

**Diversity was scored on the set, not the idea.** A reader meets these one at a time in random
order, so what they form an impression of is the *range*. Several ideas that would have made a
top-twelve on their own merits were dropped because a sibling already held their square of the grid
— Heavy Landing loses to Dragline Drop (two spider-drops is one too many), Three Tiers loses to
Pluck the Thread (one travelling wave is enough), The Letters Don't Care loses to The Spider Strains
(one comic beat on the mark). They are the first thing to reach for if a pick disappoints on screen,
and § Near-misses says so.

**Ease was weighed as real but not the tiebreak.** Nine of the thirteen are a dozen-to-twenty lines
of CSS keyed off `.logo-letter` and `.logo-image`, and none needs an SVG trace, new markup in either
component, or JavaScript beyond the picker. Two are in the expensive class and are named as such in
their entries: **Radius Sweep** (a registered custom property, a mask over the PNG, and a per-site
padding token) and **Dragline Drop** (the same padding token, and two timelines that must stay in
step). Both earn it: they are the only two ideas in 140 that treat the mark as the six-legged thing
it is, and no cheap idea does what they do.

**"Looks broken" was weighted heavily**, per the brief, and it cost the set its best thesis joke:
*What Compression Costs* — six letters winking out to show what a summary throws away — is the most
Spideryarn idea on any list, and six letters at 12% on a navigation link is a font failure to anyone
who does not already know the joke. Same fate for Torn Line, Chromatography, Broken Image, Foxing,
and every idea whose mid-flight frame is a misspelt or half-missing wordmark.

**The median hover is short, so restraint has to be instant.** The restraint list's *Held Breath*
(nothing for 520ms, then a 1px settle) is beautiful in a set and invisible to the reader whose hover
lasts 300ms — and since `.logo-home:hover` already lifts opacity `0.85 → 1` in 150ms, the pause is
not even a pause. What survives from that list responds immediately at tiny amplitude (The Settle,
Warm Drift, Only the i).

**Half the set must touch the mark**, because the word is hidden in two states an implementer
cannot ignore: the corner copy drops `.logo-text` below 731px (narrow-window.css:75) and the dock
copy drops `.dock-btn-label` at fit rungs 1–3 (dock-fit.css:165–170, 202). Seven of the thirteen are
letters-only and do nothing there; the other six animate the spider alone. The picker stays
uniform for v1 — a null hover on a phone is not a bug worth forty lines — but § What to cut first
takes that ratio into account.

### What was checked, rather than believed

The longlists made factual claims; several were wrong. Each was checked in the actual files on
2026-09-07 before any idea resting on it was ranked.

| Claim | Verdict | Evidence |
| --- | --- | --- |
| The mark is six-fold symmetric, so a 60° turn leaves it unchanged (restraint #11) | **False.** Two forelegs raised, two mid-legs splayed, two hind legs down; bilateral at best. | Rotated `public/spideryarn-logo.png` by 60° and diffed: IoU 0.25 (0.34 at 180°). Kills *Six-fold Turn* and *Played Dead*; makes any full rotation read as tumbling. |
| Vite drops `@property` and inlines its `initial-value` (tokens.css:140, safe-area.ts:27, narrow-window.css:410) | **Stale** for the current toolchain. | Built a fixture through Vite 8.2.2 + `@tailwindcss/vite` 4.3.3 with the repo's layer order: the rule survives inside `@layer app`; a `<length>` consumed in a static `calc()` resolved to the set value (51px), not the initial; Chrome 152 interpolated an `<angle>` to 109.995deg 700ms into a 2.4s turn. Scratchpad `propspike/`. Not tested in Safari or Firefox — one check there before Radius Sweep ships. |
| `.spya-anim { position: relative }` is safe on both copies (logo-animations.css:41–46) | **False — it overrides `position: fixed` on the corner copy.** | Same layer, same specificity (0,1,0), logo-animations.css is imported last (styles.css:67 vs dock.css at :37). Reproduced in Chrome: computed `position` is `relative` on `.logo.logo-home.spya-anim`. Fix is § 0 below. |
| Every token named exists: `--highlight`, `--highlight-ink`, `--highlight-wash`, `--ink`, `--ink-faint`, `--ink-soft`, `--panel`, `--page`, `--rule`, `--rule-strong`, `--chat-mark`, `--cat-N` | **True.** `--cat-N` is live via `styles/tokens.css:34`. | `src/web/styles/tokens.css`, `styles/tokens.css`, `styles/colourscales.css`. |
| A red token exists for a spellcheck squiggle (letterforms #11) | **False.** No `--danger`. | grep. |
| `--i` is set on each letter in the JSX | **False.** Neither component sets it. | HomeLogo.tsx:109, Dock.tsx:2305. Ten `:nth-child` rules in the base sheet, once, is the answer (§ 0). |
| The dock clips vertically | **True.** `.dock` is 40px tall (`--dock-h`), `overflow-y: hidden`, `align-items: stretch`. | dock.css:22–31, 94–96. Image has 10px above and below; the letter box about 12px. Anything further is cut. |
| `.logo > span` matches the wrapper in both DOMs | **True.** The link's children are one `img` and one `span` in both. | HomeLogo.tsx:107–115, Dock.tsx:2301–2309. |
| The two copies are set in different faces | **True** (the brief's correction 2). Trebuchet 600 in the corner, Geist in the dock. | `styles/tokens.css:293`, dock inherits `--font-ui`. So nothing below depends on a measured glyph width. |
| The motion guard freezes an animation at its first frame | **Half true.** It sets duration to 0.01ms and iterations to 1; with the default `fill-mode: none` the element then reverts to its *base* style. With `forwards`, it holds the 100% frame. Transitions snap to the hovered pose. | tailwind.css:134–142. The rule that matters: the base style, any `forwards` 100% frame, and any transitioned hover pose must each be a legitimate static image. Every entry below says which it relies on. |

Two things the implementer inherits that are not this pass's to fix: `docs/project/design-logo.md`
is cited from six source files (logo-animation.ts, DesignPage.tsx, Dock.tsx, HomeLogo.tsx, dock.css,
logo-animations.css) and **does not exist** — `tests/doc-links.test.ts › point at files that exist`
already fails on those eight links, before anything below is built; and `LOGO_ANIMATIONS` is not
yet read by `/design` (grep finds only the two components).

---

## 0. Before animation #1: four lines in the base

Add to `src/web/styles/logo-animations.css`, once, so no entry below has to remember them.

- **Fix the `position` clash.** Replace `.spya-anim { position: relative }` with
  `.dock-home.spya-anim { position: relative }`. `.logo-home` is already `fixed` and is already a
  containing block; the dock copy is the only one that needs it. (Or give `.dock-home` a permanent
  `position: relative` in dock-fit.css — layout-neutral either way.)
- **The letter index.** Ten rules: `.spya-anim .logo-letter:nth-child(1) { --i: 0 }` …
  `:nth-child(10) { --i: 9 }`. Every stagger below is then `calc(var(--i) * Nms)`.
- **The mark's x.** `.logo-home.spya-anim { --logo-pad: 0.7rem }`,
  `.dock-home.spya-anim { --logo-pad: 0.6rem }`,
  `.dock.dock-fit-3 .dock-home.spya-anim { --logo-pad: 0.45rem }` — the three paddings
  (dock.css:559, dock-fit.css:82, :204). The spider's centre is then
  `left: calc(var(--logo-pad) + 10px)`. Two entries need it; it is declared here so a padding change
  is one edit.
- **A soft exit for the mark.** `.logo-image { transition: transform 220ms cubic-bezier(0.33, 0, 0.67, 1) }`
  as a *resting* rule. The hook removes both classes on pointer-leave, so without this every mark
  transform snaps home; with it the spider eases back from wherever an animation left it. Letters
  cannot have the same (they return to `display: inline` and lose their transform at once) — their
  exits snap, and every letters entry below accepts that.

And one rule, not a line: **never write `opacity` on `.logo` itself.** Both copies already transition
it `0.85 → 1` on hover (dock.css:580–583, dock-fit.css:84–87). Write it on the children.

---

## The thirteen, in build order

Each entry: name — source (list · number) — class id — what the reader sees — mechanism —
numbers — the frozen frame — the one big risk. Cheap and self-contained first, so the pipeline is
proven before the two that need § 0's padding token.

### 1. The Settle — restraint · 2 + 3 — `spya-settle`

**Sees.** The spider rises a hair and leans a pixel toward the corner it links to, overshoots by a
fraction, and settles — a thing with mass arriving. The word does not move. On leave it eases back,
slower, with no bounce.

**Merged.** Restraint #2 (the vertical settle) and #3 (the half-step home) into one diagonal; the
list itself says they pair. Two axes for the price of one transition, and the lean gives the lift a
direction — *this is the way out*.

**Mechanism.** A transition, not a keyframe.

```css
.spya-settle .logo-image {
  transform: translate(-1px, -1.5px);
  transition: transform 260ms cubic-bezier(0.22, 1.32, 0.36, 1);
}
```

The exit is § 0's resting transition on `.logo-image` (220ms, no overshoot).

**Numbers.** Travel `-1px, -1.5px`; overshoot ≈ 0.4px; enter 260ms; exit 220ms.

**Frozen frame.** Transition snaps to the lifted pose: a legitimate still.

**Risk.** Invisible on a 1× display, or a second bounce if the bezier is loosened. Check on a
non-retina screen before believing it; the distance between "mass" and "bouncing ball" is 0.5px.

### 2. Pluck the Thread — spider · 1 — `spya-pluck`

**Sees.** The ten letters are a taut string. A single bump runs S → n lifting each letter 2px as it
passes, then a smaller one, then a smaller one still, and it settles. The spider does not move: it
plucked, it is listening.

**Sharpened.** Tech #8 (*Ten Delays*) is the same stagger without the decay; the decay is what makes
this a pluck rather than a Mexican wave, and it is free — three bumps of falling height in one
keyframe.

**Mechanism.**

```css
.spya-pluck .logo-letter {
  animation: spya-pluck 1.6s ease-in-out infinite;
  animation-delay: calc(var(--i) * 28ms);
}
@keyframes spya-pluck {
  0%, 75%, 100% { transform: none; }
  14%           { transform: translateY(-2px); }
  38%           { transform: translateY(-1px); }
  58%           { transform: translateY(-0.5px); }
}
```

**Numbers.** 2px / 1px / 0.5px; stagger 28ms (250ms across the word); 1.6s cycle with a 400ms rest
at the end so it re-plucks rather than hums.

**Frozen frame.** Base style — letters at rest.

**Risk.** Above ~3px it is bouncing, not vibrating; without the visible decay it is the most tired
micro-interaction on the web.

### 3. Stronger Than Steel — spider · 17 — `spya-sag`

**Sees.** The row takes a weight. The middle letters drop about 3px and the ends barely at all — a
smooth catenary, unmistakably the shape a hanging line makes and not a wave. It holds the load, then
springs back level with a faint overshoot, as if it was never going to break.

**Mechanism.** No stagger. Every letter runs the same keyframe at the same time; the curve is ten
constants.

```css
.spya-sag .logo-letter:nth-child(1)  { --sag: 0; }
.spya-sag .logo-letter:nth-child(2)  { --sag: .45; }
.spya-sag .logo-letter:nth-child(3)  { --sag: .78; }
.spya-sag .logo-letter:nth-child(4)  { --sag: .96; }
.spya-sag .logo-letter:nth-child(5),
.spya-sag .logo-letter:nth-child(6)  { --sag: 1; }
.spya-sag .logo-letter:nth-child(7)  { --sag: .96; }
.spya-sag .logo-letter:nth-child(8)  { --sag: .78; }
.spya-sag .logo-letter:nth-child(9)  { --sag: .45; }
.spya-sag .logo-letter:nth-child(10) { --sag: 0; }
.spya-sag .logo-letter { animation: spya-sag 1.6s cubic-bezier(0.33, 0, 0.15, 1) 1; }
@keyframes spya-sag {
  0%, 100% { transform: none; }
  30%, 50% { transform: translateY(calc(var(--sag) * 3px)); }
  70%      { transform: translateY(calc(var(--sag) * -0.6px)); }
}
```

**Numbers.** 3px at the centre; hold 30–50%; overshoot 0.6px; **once** per hover, 1.6s.

**Frozen frame.** Base style. `0%` is exactly neutral, on purpose.

**Risk.** One wrong number and it is a drunk font. The parabola must be symmetric and the return
must be to precisely zero.

### 4. Misregistration — styles · 11, tech · 10 — `spya-register`

**Sees.** Two ghost impressions of the word — one cool blue, one pale orange — sit a pixel and a half
off the real one and slide into perfect register in about half a second, disappearing under it. The
word ends exactly as it started, only now you have seen it assembled from plates.

**Merged.** Styles #11 supplies the direction (always *toward* register, never away — the whole
difference from a glitch) and the ending; tech #10 supplies the tokens and the interpolable
zero-offset list. Styles #8 (*Chromatic Split*) is the same move with no reason to exist and is not
taken.

**Mechanism.** `text-shadow` only; no geometry moves.

```css
.spya-register .logo-letter {
  animation: spya-register 640ms cubic-bezier(0.16, 1, 0.3, 1) 1 forwards;
  animation-delay: calc(var(--i) * 20ms);
}
@keyframes spya-register {
  from { text-shadow: -1.5px -0.5px 0 var(--chat-mark), 1.5px 0.5px 0 var(--highlight-ink); }
  to   { text-shadow: 0 0 0 transparent, 0 0 0 transparent; }
}
```

`--chat-mark` means "a chat's mark" elsewhere in the app; borrowing it is a small semantic theft
worth declaring in the stylesheet, and `--cat-4` is the alternative if it grates.

**Numbers.** 1.5px offsets, 640ms, 20ms stagger (a barely-visible lock travelling S → n), once.

**Frozen frame.** `forwards` holds the 100% frame: in register, shadows transparent.

**Risk.** Above ~2px it is the 2014 glitch cliché rather than the riso reference. Never let it end
anywhere but zero.

### 5. Warm Drift — tech · 15 — `spya-warm`

**Sees.** Almost nothing. The spider's orange drifts a few degrees warmer and back, and a very soft
glow the shape of its legs breathes in and out around it. You would not be able to describe it
afterwards; you would notice the corner felt alive.

**Mechanism.** Two filters on the image alone. `drop-shadow` rather than `box-shadow` is the point —
it follows the PNG's alpha, so the glow is leg-shaped and not a 20px square.

```css
.spya-warm .logo-image { animation: spya-warm 3.2s ease-in-out infinite; }
@keyframes spya-warm {
  0%, 100% { filter: hue-rotate(0deg) drop-shadow(0 0 0 transparent); }
  50%      { filter: hue-rotate(-8deg)
                     drop-shadow(0 0 3px color-mix(in oklab, var(--highlight) 55%, transparent)); }
}
```

**Numbers.** Hue −8°, glow 3px at 55% alpha, 3.2s, seamless.

**Frozen frame.** Base style.

**Risk.** `hue-rotate()` is a linear-RGB matrix, not a real hue rotation — the orange goes muddy past
±12°. And it may be literally invisible on a poor display, which is the silent-success shape:
screenshot-diff hovered against un-hovered before calling it done.

### 6. The Seam Opens — letterforms · 8 — `spya-seam`

**Sees.** The word splits where it really is a compound, between `r` and `y`: `Spider` slides 3px
left, `yarn` 3px right, and a single thread stretches taut across the gap. It holds while you point;
the seam closes when you leave.

**Sharpened.** The longlist positioned the thread by coordinates; anchoring it to the sixth letter's
own box needs no measurement and survives both typefaces.

**Mechanism.** Transitions on the letters (they exist before the class lands, so `none →
translateX` transitions); a keyframe on the thread, because a pseudo-element created by the class
is born at its final value and has nothing to transition *from*.

```css
.spya-seam .logo-letter { transition: transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1); }
.spya-seam .logo-letter:nth-child(-n+6) { transform: translateX(-3px); }
.spya-seam .logo-letter:nth-child(n+7)  { transform: translateX(3px); }
.spya-seam .logo-letter:nth-child(6) { position: relative; }
.spya-seam .logo-letter:nth-child(6)::after {
  content: ""; position: absolute; left: 100%; top: 55%;
  width: 6px; height: 1px; background: var(--highlight); opacity: .6;
  transform: scaleX(0); transform-origin: left;
  animation: spya-seam-thread 240ms cubic-bezier(0.2, 0.8, 0.2, 1) 180ms 1 forwards;
}
@keyframes spya-seam-thread { to { transform: scaleX(1); } }
```

**Numbers.** 3px each way (6px gap); 300ms; the thread draws 180ms after the parting begins and
holds (`forwards`).

**Frozen frame.** Transitions snap to the open pose; `forwards` holds the thread drawn. A
legitimate still.

**Risk.** Six pixels total is the ceiling; at eight the word reads as broken. And it only lands for a
reader who sees `spider` + `yarn`, which is most but not all.

### 7. The Spider Strains — principles · 16 — `spya-strain`

**Sees.** The spider leans hard to the left, legs braced, visibly stretching, as if trying to haul
the word off the screen — and the word does not budge. After a beat it gives up, springs upright,
and the letters brighten a shade, as though acknowledging they were never going anywhere. Then it
tries again.

**Mechanism.**

```css
.spya-strain .logo-image {
  transform-origin: 60% 50%;
  animation: spya-strain 1.8s ease-in-out infinite;
}
@keyframes spya-strain {
  0%, 82%, 100% { transform: none; }
  38%, 52%      { transform: translateX(-2px) rotate(-10deg) scaleX(1.1); }
  66%           { transform: rotate(4deg); }
}
.spya-strain .logo-letter { animation: spya-strain-hold 1.8s ease-in-out infinite; }
@keyframes spya-strain-hold {
  0%, 45%, 100% { color: var(--highlight); }
  62%, 78%      { color: var(--highlight-ink); }
}
```

**Numbers.** Lean −2px / −10° / `scaleX(1.1)`; hold 38–52%; recoil +4°; letters lift to
`--highlight-ink` for a third of the cycle; 1.8s loop. The `scaleX` is what sells the effort.

**Frozen frame.** Base style.

**Risk.** Anthropomorphising a 20px silhouette is a coin flip: at this size the lean may just read as
the icon being crooked. The stretch and the recoil are what make it a character beat; check at 1×.

### 8. Only the i — restraint · 13 — `spya-i`

**Sees.** One letter — the `i`, third in the word — rises a single pixel with a tiny overshoot and
stays up. Nothing else moves at all.

**Mechanism.** Four lines.

```css
.spya-i .logo-letter:nth-child(3) {
  transform: translateY(-1px);
  transition: transform 200ms cubic-bezier(0.22, 1.3, 0.36, 1);
}
```

**Numbers.** −1px, overshoot 0.3px, 200ms.

**Frozen frame.** Snaps to −1px; a still nobody could call wrong.

**Risk.** A letter sitting off its baseline is a typographic bug unless it is unmistakably in motion;
the overshoot is what carries it. And any second letter joining in turns it into a half-hearted wave.

### 9. Dawn Rebuild — spider · 8 — `spya-dawn`

**Sees.** A soft edge sweeps right to left across the whole control and everything behind it is
gone — mark and word both eaten — and at once a second edge sweeps left to right and puts it all
back, the word arriving a shade brighter and cooling to its usual orange. Eaten one way, respun the
other. Once.

**Sharpened.** The longlist loops it; a wipe every two seconds in the corner of a reading view is
too much motion, and this is the set's one-shot theatrical gesture. The eat is `ease-in` and quick;
the respin is `ease-out` and slower — tune that asymmetry out and this *becomes* the previous app's
Highlight Sweep, which the brief warns about.

**Mechanism.** One mask on `.logo`, so the `<img>` and the letters go together.

```css
.spya-dawn {
  -webkit-mask-image: linear-gradient(90deg, #000 0 40%, transparent 60% 100%);
          mask-image: linear-gradient(90deg, #000 0 40%, transparent 60% 100%);
  -webkit-mask-size: 250% 100%; mask-size: 250% 100%;
  -webkit-mask-repeat: no-repeat; mask-repeat: no-repeat;
  animation: spya-dawn 1.3s 1;
}
@keyframes spya-dawn {
  0%   { mask-position: 0 0;    animation-timing-function: cubic-bezier(0.4, 0, 1, 1); }
  42%  { mask-position: 100% 0; animation-timing-function: cubic-bezier(0, 0, 0.2, 1); }
  100% { mask-position: 0 0; }
}
.spya-dawn .logo-letter { animation: spya-dawn-glow 2.1s ease-out 1; }
@keyframes spya-dawn-glow {
  0%, 50% { color: var(--highlight); }
  62%     { color: var(--highlight-ink); }
  100%    { color: var(--highlight); }
}
```

With a 250%-wide mask, `mask-position: 0` leaves the opaque 40% exactly covering the element and
`100%` slides the transparent end fully over it; running 0 → 100% eats from the right, and 100% → 0
rebuilds from the left. The `#000` is alpha, not a colour, so it is not a token violation.

**Numbers.** Eat 550ms, respin 750ms; letters overbright for ~250ms then cool over 800ms; once.

**Frozen frame.** Base style — but note the mask is a *static* declaration on the class and only
`mask-position` animates, so at rest (before, and after with fill `none`) the mask sits at `0 0`,
fully revealing. Correct by construction.

**Risk.** The mid-wipe frame. A reader who brushes past at 300ms sees a half-drawn logo; the eat
must be fast and the edge soft enough that it reads as a wipe in progress. Also: `mask` on the
`position: fixed` corner copy creates a stacking context — check nothing shifts by a pixel.

### 10. Retype — styles · 5 + 6 — `spya-type`

**Sees.** The word drops to a faint ghost, then types itself back in from the left at the steady
cadence of a fast typist, and once it is whole a block cursor sits after the `n` and blinks at the
unhurried rate of a shell prompt for as long as you point at it.

**Merged.** Styles #6 (*Retype*) without its measured-offset cursor ride and its backspace beat;
styles #5 (*Waiting Cursor*) supplies the cursor, anchored to the last letter rather than placed as a
flex item so the row cannot reflow. Typing in from a dimmed ghost rather than from nothing is the
longlist's own mitigation for "the name is incomplete for 600ms".

**Mechanism.** Every timing function is `steps()`; nothing interpolates.

```css
.spya-type .logo-letter {
  animation: spya-type 60ms steps(1, end) 1 both;
  animation-delay: calc(var(--i) * 55ms + 120ms);
}
@keyframes spya-type { from { opacity: .3; } to { opacity: 1; } }

.spya-type .logo-letter:nth-child(10) { position: relative; }
.spya-type .logo-letter:nth-child(10)::after {
  content: ""; position: absolute; left: calc(100% + 0.1em); top: 0.12em;
  width: 0.42em; height: 0.85em; background: currentColor; opacity: 0;
  animation: spya-blink 1.06s steps(1, end) infinite;
  animation-delay: 700ms;
}
@keyframes spya-blink { 0%, 50% { opacity: 1; } 50.01%, 100% { opacity: 0; } }
```

`both` is what dims all ten letters at once at hover-in (backwards fill during each delay). The
cursor fits: 5.5px in the corner's 11px right padding, and the corner box (136px) has ~18px spare
after the word.

**Numbers.** Dim to 0.3; 55ms per character (≈200wpm); whole at 670ms; cursor 1.06s blink, on/off,
never fading.

**Frozen frame.** Delays are not flattened by the guard, so a reduced-motion reader sees the word
faint for up to 670ms and then whole; the cursor never appears (`fill: none`, base `opacity: 0`).
Not a pixel-perfect still, but a dim word is not a broken one.

**Risk.** For 670ms the app's own name is incomplete. On a slow first paint that is indistinguishable
from a font that has not loaded — the ghost, not blank, is the whole defence.

### 11. Abseil — wildcards · 8, spider · 10 — `spya-abseil`

**Sees.** The final `n` lets go of the word and drops on a single thread of yarn, bobbing on the
line's springiness, hangs a moment eight pixels below the baseline, and is reeled smoothly back up
to rejoin the word as though nothing happened.

**Merged.** Wildcards #8 at ten pixels was corner-only because it clipped in the dock; spider #10
(*Dropped Stitch*) is the same gesture at 4px on the `y`. Eight pixels on the `n` is the largest
drop that fits the dock (letter box bottom ≈ 26.5px in a 40px bar, so 34.5px), and the last letter
is the one a row of stitches actually loses.

**Mechanism.** Thread and letter share one duration so they stay locked.

```css
.spya-abseil .logo-letter:nth-child(10) {
  position: relative;
  animation: spya-abseil 2s infinite;
}
@keyframes spya-abseil {
  0%        { transform: none;           animation-timing-function: cubic-bezier(.34, 1.56, .64, 1); }
  28%, 58%  { transform: translateY(8px); animation-timing-function: ease-in-out; }
  84%, 100% { transform: none; }
}
.spya-abseil .logo-letter:nth-child(10)::before {
  content: ""; position: absolute; left: 50%; top: -8px; width: 1px; height: 8px;
  background: var(--highlight); opacity: .6;
  transform: scaleY(0); transform-origin: top;
  animation: spya-abseil-thread 2s infinite;
}
@keyframes spya-abseil-thread {
  0%        { transform: scaleY(0); animation-timing-function: cubic-bezier(.34, 1.56, .64, 1); }
  28%, 58%  { transform: scaleY(1); animation-timing-function: ease-in-out; }
  84%, 100% { transform: scaleY(0); }
}
```

The pseudo rides with the letter, so a thread anchored 8px above the letter's top is anchored at
the letter's *original* top once it has dropped 8px.

**Numbers.** 8px; spring on the drop, plain ease on the reel; hang 28–58%; 2s loop.

**Frozen frame.** Base style — letter in the word, thread at zero length.

**Risk.** Vertical room: 8px is within the dock's clip by ~5px and no more; measure it, and do not
"tidy" it to 10. The word reads `Spideryar` with a dangling `n` for most of a second — a joke, but
on a link, so the thread has to be visible or it is a missing letter.

### 12. Dragline Drop — spider · 2 — `spya-dragline`

**Sees.** The spider drops straight down out of its slot, paying out a hairline thread from where it
was, hangs for a beat swinging a degree or two, then climbs briskly back up and the thread retracts
into nothing. The single most recognisable thing a spider does, in about a second and a half.

**Expensive class**, and why: it needs § 0's `--logo-pad` to place the thread at the mark's centre in
both copies (three paddings), and two timelines that must not drift. Worth it because a dragline is a
spider's undo — it never lets go of where it came from — which is the citation promise drawn.

**Mechanism.**

```css
.spya-dragline .logo-image { animation: spya-dragline 1.6s ease-in-out infinite; }
@keyframes spya-dragline {
  0%, 100% { transform: none; }
  30%      { transform: translateY(8px) rotate(2deg); }
  44%      { transform: translateY(8px) rotate(-2deg); }
  58%      { transform: translateY(8px) rotate(1deg); }
  84%      { transform: none; }
}
.spya-dragline::before {
  content: ""; position: absolute; pointer-events: none;
  left: calc(var(--logo-pad) + 10px); top: calc(50% - 10px);
  width: 1px; height: 8px; background: var(--highlight); opacity: .7;
  transform: scaleY(0); transform-origin: top;
  animation: spya-dragline-thread 1.6s ease-in-out infinite;
}
@keyframes spya-dragline-thread {
  0%, 100% { transform: scaleY(0); }
  30%, 58% { transform: scaleY(1); }
  84%      { transform: scaleY(0); }
}
```

The thread runs from the anchor (the image's original top edge) down to the dropped spider's top.

**Numbers.** 8px — the image's bottom sits at 30px in the dock's 40px, so 38px is the floor; the
corner's 44px box has room to spare. Swing ±2°; hang 30–58%; 1.6s loop.

**Frozen frame.** Base style.

**Risk.** The hard-coded x drifts silently if a padding changes without `--logo-pad` following, and a
1px vertical line at some device-pixel ratios renders as a grey smear rather than an orange thread.

### 13. Radius Sweep — spider · 3, tech · 1 — `spya-radius`

**Sees.** A paler band of orange travels round the spider like a hand on a clock face, lighting each
of the six legs in turn as it passes — while the rest of the mark stays its ordinary orange and
nothing moves. The light goes round; the spider is polling its web.

**Expensive class**, and why: a registered custom property (the `from` angle of a `conic-gradient`
is not interpolable without one), a painted box masked to the PNG's alpha, and `--logo-pad` to seat
it over the image. It is the only idea in 140 that treats the mark as the radial object it is, it is
colour-only so it composes with the dock's tightest rung, and the mechanism was verified end to end
(§ What was checked): the rule survives the build inside `@layer app` and Chrome animates it.

**Merged.** Tech #1's overlay-over-the-real-image (so a browser that drops the pseudo still shows a
correct static spider) with spider #3's leg-by-leg reading; the two are the same idea from opposite
lanes.

**Mechanism.**

```css
@property --spya-angle { syntax: "<angle>"; inherits: false; initial-value: 0deg; }

@supports (mask-image: linear-gradient(#000, #000)) or (-webkit-mask-image: linear-gradient(#000, #000)) {
  .spya-radius::after {
    content: ""; position: absolute; pointer-events: none;
    left: var(--logo-pad); top: calc(50% - 10px); width: 20px; height: 20px;
    --spya-angle: 0deg;  /* keeps the gradient valid where @property is unsupported */
    background: conic-gradient(from var(--spya-angle),
      var(--highlight) 0turn, var(--highlight-ink) 0.16turn,
      var(--highlight) 0.4turn, var(--highlight) 1turn);
    -webkit-mask: url(/spideryarn-logo.png) center / 20px 20px no-repeat;
            mask: url(/spideryarn-logo.png) center / 20px 20px no-repeat;
    animation: spya-radius 2.4s linear infinite;
  }
}
@keyframes spya-radius { to { --spya-angle: 360deg; } }
```

The overlay is the same orange as the PNG everywhere except the lit band, so it paints over the real
image without hiding it. `--highlight-ink` is the orange lifted with white, which reads as light on
the dark ground (brief, correction 1).

**Numbers.** Band 0.16 turn wide, fading out by 0.4; one turn in 2.4s, `linear` — a sweep is a
clock and easing it is a lie about the timebase; seamless.

**Frozen frame.** Base style; the pseudo sits at `0deg` (a static two-tone spider, which looks
deliberate) for the 0.01ms it exists.

**Risk.** Safari and Firefox have not been checked for `@property` nested inside `@layer` — do that
once, in a real browser, before shipping; if it fails there, the declared `--spya-angle: 0deg`
leaves a static two-tone mark rather than a broken one. Second: `url(/spideryarn-logo.png)` inside
CSS goes through Vite's asset handling — confirm it resolves to the public file in the built sheet
and is not inlined or rewritten.

---

## Diversity table

The five spans the brief asked for, so it is visible whether the set covers them or only claims to.
*Amplitude*: sub (≤1.5px or colour only, not consciously visible) · small · medium · theatrical.

| # | id | Amplitude | What moves | Shape of motion | Register | Meaning |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `spya-settle` | sub | mark | physical settle (transition) | earnest | beauty — material |
| 2 | `spya-pluck` | small | letters | travelling wave, damped | warm | thesis — reading by feel |
| 3 | `spya-sag` | medium | letters | physical settle, one-shot | earnest | fact — silk is strong |
| 4 | `spya-register` | small | neither (shadows) | one-shot, ends at rest | technical | thesis — passes agree |
| 5 | `spya-warm` | sub | neither (colour/light) | seamless loop | warm | beauty |
| 6 | `spya-seam` | small | letters | state change, held | warm | thesis — the compound |
| 7 | `spya-strain` | medium | mark (+ letter colour) | loop of gestures | **funny** | thesis — the text stays |
| 8 | `spya-i` | sub | letters (one) | state change, held | **funny**, deadpan | joke — close reading |
| 9 | `spya-dawn` | theatrical | both (mask) | one-shot wipe | earnest | thesis — re-reading |
| 10 | `spya-type` | medium | neither (opacity steps) | discrete, then a loop | technical | beauty — a tool, waiting |
| 11 | `spya-abseil` | theatrical | letters (one) | physical, loop | **funny** | joke — yarn |
| 12 | `spya-dragline` | theatrical | mark | physical, loop | earnest | thesis — never lets go of the source |
| 13 | `spya-radius` | small | neither (light) | seamless loop | technical | thesis — attention, one radius at a time |

Tallies: amplitude 3 sub / 4 small / 3 medium / 3 theatrical. What moves: mark 3, letters 5, both 1,
neither 4. Shape: one-shot 3 (#3, #4, #9), seamless loop 2 (#5, #13), looping gesture 3 (#7, #11,
#12), travelling wave 1 (#2), held state 3 (#6, #8, #10), settle 1 (#1). Register: earnest 4,
technical 3, warm 3, funny 3 (two of them quietly). Meaning: eight say something about the product
or the name, five are only beautiful or only a joke — the brief said not all need a thesis.

Where the word is hidden (corner < 731px; dock rungs 1–3), entries 2, 3, 4, 6, 8, 10, 11 do nothing
and 1, 5, 7, 9, 12, 13 still run. Six of thirteen, which is the ratio § How this was decided asked for.

---

## Near-misses

The ideas that nearly made it, with what kept each out. This is the section to reopen if a pick
above disappoints on screen.

- **The Letters Don't Care** (wildcards #4) — the spider spins and wobbles to a halt; the letters do
  not acknowledge it. The funniest deadpan on any list and the cheapest. Out because it is a third
  comic beat on the mark, and the diff shows the mark is not radially symmetric, so a full tumble at
  20px reads as the icon being thrown. **First replacement for #7** if the lean does not read.
- **Heavy Landing** (styles #2) — the spider drops in from 5px above, squashes flat, and the shock
  ripples through the letters. Out only because Dragline already spends the mark's vertical budget;
  two spider-drops in twelve is one too many. Its volume-conserving squash is worth stealing if
  Dragline's hang looks stiff.
- **Three Tiers** (features #2) — one letter bright, its neighbours dimmer, the rest dimmer still,
  travelling in steps: the gist column's own fisheye. Out because stepped opacity on 13px type is the
  "rendering fault" failure and Pluck holds the travelling-wave square. The best *product* idea not
  taken.
- **What Compression Costs** (principles #14) — six letters fade to 12% and come back. The best
  thesis joke of the 140, and the surest to look like a font failure on a navigation link.
- **The Bridge Line** (spider #16) — a thread hunts across the top of the word and snaps taut, and
  only then do the letters light. Lovely, and its payoff is at 900ms; the median hover is shorter.
  Keep for a long-press-only tier if one is ever built.
- **The Tittle Falls** (letterforms #2) — the dot of the `i` drops to the baseline and springs
  back. Highest ceiling in its list; the 0.34em cut line is a guess about one face and there are
  three in play (Trebuchet, its Linux fallback, Geist).
- **Rack Focus** (styles #16) — focus pulls between spider and word. Blur on 13px text is "badly
  rendered" on a 1× display; the spider half alone is Warm Drift without the warmth.
- **Silk Line** (tech #2) — a sheen through the letterforms via `background-clip: text`. It is the
  previous app's Silk Shimmer Sweep by another name, and the transparent-fill failure mode is an
  invisible wordmark; site.css already carries the two guards, but the brief said not to re-list.
- **Six-fold Turn** (restraint #11) — a 60° turn that leaves the mark unchanged. Killed by the
  diff (IoU 0.25): the mark would end visibly askew and stay there.
- **Cursor Tether** (wildcards #9) — a thread from the spider to the pointer. The one JS idea worth
  its JS, and the only rAF loop anyone proposed; out because it does nothing on touch, where the
  long press lives.

Folded into a pick rather than dropped: *One Step Home* → #1; *Ten Delays* → #2; *Out of Register*
and *Chromatic Split* → #4; *Dropped Stitch* → #11; *Waiting Cursor* → #10; *Angle Turn* → #13.

---

## What to cut first

If thirteen is too many, in this order:

1. **Only the i** (#8) — the cheapest to lose and the most likely to be read as a typo; #1 already
   holds the sub-perceptual square.
2. **Warm Drift** (#5) — overlaps Radius Sweep as a mark-only light loop; keep the one with the
   thesis.
3. **Retype** (#10) — the incomplete-name risk, and the only medium-cost letters entry; the terminal
   register is nice to have, not necessary.
4. **Dawn Rebuild** (#9) — the mid-wipe frame is the set's biggest "looks broken" exposure; cutting it
   loses the only whole-mark wipe, so cut it last of these four.

Do not cut below nine. `pickLogoAnimation` excludes only the previous draw, so the animation from
*two* hovers ago comes back with probability 1/(n−1): one in eight at nine, one in seven at eight,
and by then the reader's model of "a new one each time" is being contradicted often enough to
notice. Nine also keeps five mark-involving entries for the states where the word is hidden.

---

Brief: [260907f-logo-animations-brief.md](260907f-logo-animations-brief.md). Longlists:
[principles](260907f-logo-animations-longlist-principles.md) ·
[features](260907f-logo-animations-longlist-features.md) ·
[spider](260907f-logo-animations-longlist-spider.md) ·
[tech](260907f-logo-animations-longlist-tech.md) ·
[styles](260907f-logo-animations-longlist-styles.md) ·
[letterforms](260907f-logo-animations-longlist-letterforms.md) ·
[restraint](260907f-logo-animations-longlist-restraint.md) ·
[wildcards](260907f-logo-animations-longlist-wildcards.md).

Up: [plans.md](../project/plans.md)
