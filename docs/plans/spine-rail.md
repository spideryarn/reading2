# The spine: half the width, and cards worth stopping for

> let's make the Spine a little bit narrower. If there isn't already a constant defining its width,
> define one, and then halve it from the current. Also, it no longer has hover-tooltips - I'd like
> the Spine to have really rich hover-tooltips (perhaps hierarchical, based on the ToC? and/or
> perhaps use the Summary for that section?). This might deserve its own Opus subagent and GPT Sol
> review.
>
> — Greg, 2026-08-28

Three pieces, and the first one changes the shape of the other two: **the hover cards are not
missing, they are being closed a tenth of a second after they open.** That is a regression with a
named commit and a two-line fix, so piece 3 is "make an existing surface say more" rather than
"build a surface". Halving the rail then makes the card the *only* thing on the rail carrying a
word, which raises what it has to be worth.

Background: [granularity-zoom.md § The spine](../project/granularity-zoom.md#the-spine-a-birds-eye-rail),
[tooltips.md](../project/tooltips.md), [`src/web/Spine.tsx`](../../src/web/Spine.tsx),
[`src/web/layout.ts`](../../src/web/layout.ts).

---

## 1. The cards stopped opening, and why

**Finding: a regression, introduced by `bf398f3` ("Tap the spine to read it", 2026-08-27), the
commit that made the rail tappable.** Not a hit-target problem, not z-index,
not pointer-events, not a 240ms delay anyone had to wait out, and not missing data — `BandCard`
renders exactly what `granularity-zoom.md` claims it does. It renders it for about 90ms.

### What the code does

Before `bf398f3` every band's `<Tooltip>` was **uncontrolled**: each one owned a private
`useState`. `bf398f3` needed a card that survives a tap, so it made all of them **controlled off one
piece of `Spine` state**, `armed`, with

```ts
onOpenChange={(v) => setArmed(v ? { id, byTouch: false } : null)}
```

One state serving fifty triggers is the bug, and Floating UI clears it from two directions. Both are
correct against an uncontrolled tooltip, because there a close only ever touches the tooltip's own
state:

1. **`useDelayGroup` closes every other member of the group.** `<TooltipGroup>` is
   `FloatingDelayGroup`, and one-open-at-a-time is enforced in a layout effect that runs the moment
   any member opens:

   ```js
   if (currentId !== id) onOpenChange(false);   // @floating-ui/react 0.27.20
   ```

   So the ~49 bands that were *never open* each called `setArmed(null)` in the same commit in which
   the band under the pointer set `armed = {id}`.

2. **`useHover` schedules a departing band's close without checking who is open.**
   `onReferenceMouseLeave` → `closeWithDelay` → `setTimeout(() => onOpenChange(false), 90)`, with no
   test that this band is still the one showing. Running the pointer down the rail therefore kills
   the card you have just arrived at, 90ms behind you — which is the exact opposite of what the
   grouping exists for ([tooltips.md § Grouping](../project/tooltips.md#grouping-and-why-the-delays-are-what-they-are)).

### The measurement

`tests/spine-hover.test.tsx` drives the real `<Spine>` in jsdom and samples the DOM every 25ms after
a native `mouseenter` on a band:

```
   0–225ms  cards=0     (the 240ms open delay)
 250–325ms  cards=1     ← the card
 350ms →    cards=0     and it never comes back
```

`armed` is already `null` in the commit the card mounted in; the 80ms it stays visible is nothing
but `useTransitionStyles`' exit animation. A reader sees a faint flash and reads it as nothing.

Independently confirmed in a real browser (Chrome, dev server, visible tab) — see § Evidence.

### Why nothing caught it

`tests/spine-tap.test.ts` covers `bandPress`, which is the *decision* a press makes, and every one
of its assertions passed throughout the outage. The bug is in the event and effect ordering
*around* the decision. This is the same shape as the blocker GPT Sol found in `bf398f3` itself —
"in a place a unit test cannot reach" — and the lesson is that the thing worth testing was never
`bandPress` but **after hovering a band, is there a card**, which is the only question a reader asks.

### The fix

Two lines in `Spine.tsx`: a close only counts from the band that is open.

```ts
onOpenChange={(v) =>
  setArmed((prev) =>
    v ? { id, byTouch: false } : prev?.id === id ? null : prev,
  )
}
```

Applied; all five cases in `tests/spine-hover.test.tsx` green, two of them red before it. A
postmortem goes in `docs/postmortems/spine-hover-cards.md`.

**Rejected: going back to uncontrolled tooltips.** That is what worked before, and it would take the
tap gesture with it — `mouseOnly` in `Tooltip.tsx` is keyed on `controlled`, and reveal-then-commit
needs an owner of "which card is open" that outlives a synthesised `mouseleave`
([touch.md](../project/touch.md)).

**Rejected: dropping `<TooltipGroup>`.** The grouping is the reason the rail is scrubbable, and with
the guard in place it costs nothing.

---

## 2. Halving the rail

`SPINE_W = 24` already exists in [`layout.ts`](../../src/web/layout.ts). **24 → 12.** The work is not
that line; it is the eight other places the same number lives.

### Everywhere 24 is written down

| Where | What it is | Becomes |
|---|---|---|
| `layout.ts` `SPINE_W = 24` | the layout arithmetic | `12` |
| `styles.css` `:root { --spine-w: 1.5rem }` | the default | `0.75rem` |
| `styles.css` `.reader.spine-on { --spine-w: 1.5rem }` | the on state | `0.75rem` |
| `styles.css` `.spine { --spine-gutter: 15px }` | how much of the rail search lanes may take | see below |
| `styles.css` `.spine { --lane-max: 5px }` | the widest one lane may get | see below |
| `styles.css` `.spine-tick { left: 4px }` | the L2 hairline's inset | `2px` |
| `styles.css` `@media (max-width: 743px)` | `GIST_MIN + PROSE_MIN + spine − 1` | `731px` |
| `styles.css` `@media (max-width: 855px)` | `MODE_MIN + PROSE_MIN + spine − 1` | `843px` |
| `scroll.ts` `SMALL_DEVICE = "(max-height: 620px), (max-width: 743px)"` | the same narrow-window number, reused | `731px` |
| `tests/layout.test.ts` | `24`, `744/743`, and the 1600px widths | `12`, `732/731`, `[240,240,240,868]` |
| `tests/chat.test.ts` | `856/855` and "856 − 24 spine" | `844/843` |

The two media queries are the dangerous ones. They are *derived* from `SPINE_W` and the stylesheet
says so in a comment, but CSS cannot read a TypeScript constant, so the derivation is performed by
hand. Move one and not the other and there is a 12px band of window widths where `fitView` offers a
gist column that the stylesheet has already decided there is no room for — which is precisely the
bug the 743/855 comments describe having happened once already.

### One source of truth, across a boundary CSS cannot cross

The pattern this repo uses for `--mode-w` is *JS writes the custom property* — `App.tsx` sets
`"--mode-w": ${fit.modeW}px` inline on `.reader`. That would work for `--spine-w` too, and it fixes
exactly one of the four derived numbers: the media-query breakpoints stay hand-copied, because a
`@media` query cannot read a custom property and `@custom-media` is not shipped anywhere.

So instead: **the numbers stay where they are, and a test makes drift impossible.**
`tests/spine-width.test.ts` reads `src/web/styles.css` and `src/web/scroll.ts` as text and asserts

- `--spine-w`, in both places it is declared, converts to exactly `SPINE_W` px at a 16px root;
- the narrow-window query is exactly `GIST_MIN + PROSE_MIN + SPINE_W − 1`;
- the mode-band query is exactly `MODE_MIN + PROSE_MIN + SPINE_W − 1`;
- `scroll.ts`'s `SMALL_DEVICE` literal is the same number as the narrow-window query.

That needs `SPINE_W`, `GIST_MIN` and `PROSE_MIN` exported from `layout.ts` (`MODE_MIN` already is).
The test is checked against the broken state before it is believed: each assertion is watched going
red with the number nudged by one.

This is the same species as `tests/doc-links.test.ts` — a cheap deterministic check standing where a
compiler cannot.

### What a 12px rail actually breaks

- **The search lanes.** `--spine-gutter: 15px` of a 24px rail is 62% of it, and three lanes fill it
  exactly. Halving it proportionally gives 7.5px and a 2.5px bar for a single search, which is close
  to the 1.5px floor `.spine-match` already has to defend against. Proposal: **`--spine-gutter: 8px`,
  `--lane-max: 4px`** — two thirds of the rail rather than 62%, so one search still draws a 4px bar
  and two searches fill the gutter exactly. The reasoning is that a mark's legibility is *absolute*,
  not relative to the rail: a 2.5px bar is not "the same, smaller", it is a bar you cannot tell from
  a hairline. The cost is that the coloured gutter is now a larger share of a narrower rail, so the
  bands' own tint has proportionally less room; that is the right trade, because during a search the
  marks are what the reader came to the rail for. Above three simultaneous searches the lanes get
  thinner than before — already true, already flagged in the stylesheet, and the panel still lists
  every one of them.
- **The L2 hairline ticks.** `left: 4px` is a 1/6 inset; `2px` keeps it.
- **Click targets.** Unchanged in height — a band's height is a percentage of the document and has
  a `min-height: 4px` floor — and halved in width. For a mouse this is nearly free: the rail is
  flush against the left edge of the viewport, and an edge target is the easy case (Fitts).
- **Touch is the real cost, and it is a cost the rail already had.** 24px was already far below every
  44/48px guideline; 12px is half of far below. What defuses it is that the rail is
  reveal-then-commit on a finger, so a mis-tap costs a card, not a jump
  ([touch.md](../project/touch.md)). **Proposal: extend the hit targets 12px to the right of the
  painted rail on a coarse pointer only**, so a finger keeps the 24px it has today while the paint
  loses half its width. That needs one structural change, because `.spine` is `overflow: hidden` and
  would clip them: move the painted layers (parts, ticks, marks, viewport band) into an inner
  `.spine-paint` div that carries the `overflow: hidden`, and let `.spine-track`'s hit buttons
  overflow. The 12px they overhang is the block-id gutter, which is `--ink-faint` chrome rather than
  prose, and only under `(pointer: coarse)`.

  *If that is judged over-engineering, the fallback is to accept a 12px target and say so in
  touch.md.* Flagging for the review rather than deciding alone.
- **The layout fit.** A narrower rail hands 12px back to the table. `tests/layout.test.ts` sweeps
  320–2600px asserting the column count never falls as the window grows; the rail is a constant at
  every width, so the sweep cannot go non-monotonic — but the crossover moves by 12px and the pinned
  literals move with it.
- **Nothing else.** `.spine-hit { min-height: 4px }`, `.spine-viewport { min-height: 2px }` and
  `.spine-match { min-height: 3px }` are all vertical.

---

## 3. Cards worth stopping for

Today's card: crumb (part title) · title · gist · up to five sub-section **titles** · words · matches
· % in. That is already the list `granularity-zoom.md` promises, and the promise is accurate. What
it is missing is **hierarchy that says where you are**, which is Greg's first suggestion, and it is
missing it while the data is already in the component.

### The constraint first

> people do not read a shrunk periphery … discrete tiers, never a gradient
>
> — [column-context.md](../project/column-context.md)

A hover card that is a wall of text is worse than the sliver it explains, and it is *much* worse when
the pointer is scrubbing: the group makes neighbours open instantly, so a card that takes a second to
parse turns a scrub into a strobe. **Everything added below is one line or fewer, ellipsised, and
scannable without reading.**

### What is already in `Spine`, unused

`App.tsx` builds the outline **three levels deep** precisely so a card can list sub-sections, and the
rail only draws two. So a section band's `children` are its paragraphs, with `navLabel` and `title`
— navigation chrome, which the node shape sanctions in exactly two places and the spine is one of
them ([granularity-zoom.md § Node shape](../project/granularity-zoom.md#node-shape)). No new data,
no new fetch, no visitor gating.

The one thing the card throws away today is the **parent**: `Band.parentTitle` is a `string`, so the
card knows the part's name and nothing else about it. Widening that field to the parent
`OutlineEntry` gives, for free, the part's **gist**, its **child count**, and this section's
**index within it** — which is the whole of "hierarchical, based on the ToC".

### The card

```
┌──────────────────────────────────────────────┐
│ WHAT FEELING IS FOR            ·  3 of 7     │   crumb + where in the part
│ ─────────────────────────────────────────────│
│ The body as a model                        § │   title, § = author's own heading
│ Perception runs outwards from the body's     │   gist
│ own predictions rather than inwards from     │
│ the senses.                                  │
│ ─────────────────────────────────────────────│
│ · Prediction, not reception                  │   children, each with its own
│     the retina sends less than it receives   │   gist on a second dimmed line
│ · Why colour is a guess                      │
│     wavelength is not the thing you see      │
│ · + 3 more                                   │
│ ─────────────────────────────────────────────│
│ 640 words   4 matches   38% in     you are here│
└──────────────────────────────────────────────┘
```

Changes, each with its reason:

1. **`· n of m` on the crumb line.** One number pair, and it is the one thing a proportional rail
   cannot show: how far through *this part* the band sits, as opposed to how far through the
   article. Costs no line.
2. **Each sub-section gets its gist**, one dimmed ellipsised line under its title, `MAX_CHILDREN`
   dropping from 5 to 4 so the card does not grow. A list of five bare titles is a table of
   contents; a list of four titles *with* what each says is the thing that lets a reader decide
   whether to go there, which is what the card is for.
3. **`you are here`** in the footer when the reader's current position is inside this band. The rail
   already computes `here`. It is the difference between reading the card as *what is over there*
   and as *what I am in*, and on a 12px rail nothing else says it.
4. **The part's own gist** is deliberately **not** added. Two gists in one card is the wall. The
   part's name plus `n of m` places you; if you want the part's gist you hover the part, which is
   what the rail's L1 bands are.

### On Greg's second suggestion — "use the Summary for that section"

**Recommended against for the card, and worth writing down why.** `summaries.json`'s two useful
rungs (`short`, `long`) are *generated*, so an article that has only been through the ToC stage has
neither; a visitor may not have access to them at all (`visitor.ts`, the `available` / `visitorGap`
machinery); they arrive through a separate fetch the rail does not make; and a `short` is a
paragraph, which is the wall this section is trying to avoid on a surface the pointer crosses fifty
times a minute. The `gist` rung *is* the tree node's own gist — already in the card.

**The one that would earn its place is the arc.** `arc.json` is one sentence per part saying where
the whole argument stands by that point — a claim about the article made from a position inside it,
which is exactly what a bird's-eye rail is about
([granularity-zoom.md § The arc](../project/granularity-zoom.md#the-arc)). `App.tsx` already has
`article.arc` in hand and passes it to `buildArcColumn`. Adding it to a **part's** card (never a
section's) is one new optional prop on `<Spine>` and one line in `App.tsx` — which belongs to the
Outline-mode session, so it is proposed to them rather than done. **Optional; the card must be
complete without it**, since `arc.json` is null until `npm run arc` has been run.

### Degrading

| The article has been through | The card shows |
|---|---|
| ToC only (stage 4) | crumb · `n of m` · title · gist · sub-section titles+gists · footer |
| no `arc` | the same; no arc line |
| a childless part | crumb-less: title · gist · footer |
| a leaf with no gist | title · `navLabel` in italic (unchanged, and it stays italic — it is not a gist) |

### Reuse

The Outline-mode session wants a hierarchical hover card too. If piece 3 produces one worth sharing
it will be exported from `Spine.tsx` by name with its props, and offered to them before it is
written, so there is one of these rather than two.

---

## Evidence

- `tests/spine-hover.test.tsx` — five cases against the real `<Spine>`; two red before the fix.
- `tests/spine-width.test.ts` — the CSS/TS drift check, each assertion watched going red.
- A browser pass on a visible tab (the rail measures inside `requestAnimationFrame`, so a hidden tab
  shows an empty rail and no hit targets — [browser-testing.md](../project/browser-testing.md)).
- GPT Sol on this plan before building, and on the diff after.

## Not doing

- **Bringing back a labelled rail at any width.** Deleted 2026-08-26 by Greg, and the reason it went
  is the reason a narrower rail is fine: names live in the card.
- **Making the card interactive.** Every tooltip on the page but the prose hover card is
  `pointer-events: none`, and a spine card that took hover would land under the pointer and keep
  itself open ([tooltips.md](../project/tooltips.md)).
- **Switching to Radix.** Unchanged from tooltips.md's verdict, and doing it in the same change as a
  regression fix would make it impossible to say which one moved the feel.
