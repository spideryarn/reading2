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

**Not confirmed in a browser, across two attempts, and the reason is worth keeping.** The first
pass sampled at t=0, t≈1s and t≈2s; the card exists between roughly 240ms and 330ms, so all three
samples miss it and its "no tooltip ever appears" is equally predicted by the bug *and* by the fix.
It also ran in a tab reporting `visibilityState: "hidden"` with a zero rAF count — the documented
state in which nothing animates ([browser-testing.md](../project/browser-testing.md)) — and saw the
app's `[boot]` error screen twice while vite reconnected. The second pass, run against the built
code with an explicit visibility probe as its first step, **could not get a visible tab at all**: a
dozen agent sessions share one Chrome profile and the frontmost application stayed the terminal. It
fell back to a `requestAnimationFrame` shim, which is a real technique and is not the same thing.

So the evidence for piece 1 is `tests/spine-hover.test.tsx`, watched red before the fix and green
after. § Evidence has what the second pass *is* good for — the parts that do not depend on rAF.

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
| `styles.css` `.reader { --spine-w: 1.5rem }` | the default — on `.reader`, not `:root` | `12px` |
| `styles.css` `.reader.spine-on { --spine-w: 1.5rem }` | the on state | `12px` |
| `styles.css` `.reader.spine-off { --spine-w: 0rem }` | the off state | `0px` |
| `preview-colour.tsx` `MODE_MIN + 24` | the dev preview's state dump | `MODE_MIN + SPINE_W` |
| `styles.css` `@media (max-height: 620px), (max-width: 743px)` | § a small device — a *second* copy of the narrow-window number | `731px` |
| `styles.css` `.spine { --spine-gutter: 15px }` | how much of the rail search lanes may take | see below |
| `styles.css` `.spine { --lane-max: 5px }` | the widest one lane may get | see below |
| `styles.css` `.spine-tick { left: 4px }` | the L2 hairline's inset | `2px` |
| `tests/layout.test.ts` `fit({ windowWidth: 1279 })` | "shrinks before it drops" — **stops shrinking** at a 12px rail | `1275` |
| `tests/chat.test.ts` `band(966)` | "the band gives way" — **stops giving way** | `band(954)` |
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

**And the two sides were not in the same unit, which no amount of care about the numbers would
have caught.** `SPINE_W = 24` against `--spine-w: 1.5rem` are equal only at a 16px root, and nothing
in this app locks the root font size: a reader who has set their browser to 20px was getting a 30px
rail while `fitView` went on subtracting 24, so the table was 6px wider than the layout believed.
The stylesheet is now `12px`. GPT Sol found it reviewing this plan, and its sharper point was that
the drift test as first designed *would have certified the disagreement as correct*.

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
  to the 1.5px floor `.spine-match` already has to defend against. **Built: `--spine-gutter: 10px`,
  `--lane-max: 5px`** — the gutter did not halve and the cap did not move, so one search and two
  searches each draw the *same 4px bar they drew on the 24px rail*, and two fill the gutter exactly.
  The reasoning is that a mark's legibility is *absolute*, not relative to the rail: a 2.5px bar is
  not "the same, smaller", it is a bar you cannot tell from the L2 hairline beside it.

  (The plan first proposed 8px/4px. Sol pointed out that "one search is a 4px bar" had forgotten the
  `- 1px` separator, and that 8/4 pushes the merge point further in than it needs to go.)

  The cost is at the crowded end, and the numbers are worth writing down because the stylesheet's old
  comment was vague about them. Pitch is `min(5px, 10 / lanes)` — the cap is what gives one *and* two searches the same 4px bar — and painted width is `max(1.5px, pitch - 1px)`, so
  the widths run **4px, 4px, 2.33px, 1.5px** for one to four searches; the floor governs from four,
  and from **seven** it exceeds the pitch and adjacent bars merge into one band of colour. On the
  24px rail that was eleven. No 12px rail can do better — eight distinguishable lanes at a 1.5px
  stroke with a 1px gap needs 20px — and the panel still lists every one of them.

  A cost that reads worse than it is: 10px of gutter on a 12px rail sounds like the bands losing five
  sixths of their width. They do not. `.spine-matches` is rendered only when something matched, and a
  mark is only as tall as the paragraph it names, so the gutter is the width a mark *may* reach on
  the rows that matched — not a stripe down the rail.
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

  **Not built, after the review.** Sol found enough underneath the structural change to stop: the
  overhang covers the first 12px of the mode band whenever one is open (the rail is z-index 45 and
  the band 44, so the rail wins), it makes `elementFromPoint` return a depth-1 rail button over a
  strip of the table, and `(pointer: coarse)` describes only the *primary* pointer — so a hybrid
  device gets it wrong in one direction or the other, which is the mistake `bandPress` already had
  to unlearn once. It wants a browser pass over the hit map behind it, and doing it blind in the
  same change that moves the width would make it impossible to say which one moved the feel.

  So the stated fallback is what shipped: a 12px target, with the whole argument written down in
  [touch.md](../project/touch.md) rather than left as a thing somebody would have to rediscover.
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

### What is already in `Spine`, and what is not

`App.tsx` builds the outline **three levels deep** precisely so a card can list sub-sections, and the
rail only draws two. So a section band's `children` are its paragraphs — and this is where the plan
was wrong, in a way that turned out to matter more than anything it proposed.

**The child list has been rendering empty bullets since the spine was written.** It renders
`c.node.title`, and the children of a hover card's band are *depth-3 leaves*: the node shape gives a
section a heading title and a leaf a `navLabel` ([granularity-zoom.md § Node
shape](../project/granularity-zoom.md#node-shape)). Counted over every article in `data/`:

```
888 depth-3 nodes    0 with a title    0 with a gist    853 with a navLabel
```

So every card on every article listed up to five bullets with no text beside them, and `+ 3 more`
counted rows that said nothing. **Nobody noticed for two reasons, and both are the interesting
part.** A bullet with no text reads as a design rather than a fault — there is no error, no gap, no
missing-data placeholder, just a slightly sparse list. And no test could see it: every fixture in
the suite gives its entries `children: []`, so the list was never rendered once in the whole test
suite. A corpus that cannot exercise its arm.

GPT Sol found it by checking the plan's premise against the data rather than against the prose, while
reviewing a proposal to add *a second blank line under each blank bullet*.

The fix is one line and it changes what the plan's piece 3 can be: **the rows show `navLabel`**,
falling back to a title if one ever appears, rows with neither are filtered out (4% of them), and
`+ n more` counts the filtered list. `navLabel` belongs here for the reason it belongs anywhere —
this is navigation chrome, and the spine is one of the two places the node shape sanctions it.

The one thing the card threw away is the **parent**: `Band.parentTitle` was a `string`, so the card
knew the part's name and nothing else about it. It is now `{ title, index, total }` — enough for
this section's place in its part, and deliberately not the parent `OutlineEntry` itself, which would
hand the card the whole subtree to render one line.

### The card

```
┌──────────────────────────────────────────────┐
│ WHAT FEELING IS FOR                 3 of 7   │   crumb + where in the part
│ ─────────────────────────────────────────────│
│ The body as a model                        § │   title, § = author's own heading
│ Perception runs outwards from the body's     │   gist
│ own predictions rather than inwards from     │
│ the senses.                                  │
│ ─────────────────────────────────────────────│
│ · the retina sends less than it receives     │   children, one line each,
│ · wavelength is not the thing you see        │   their nav labels
│ · colour is a guess the brain checks         │
│ · + 3 more                                   │
│ ─────────────────────────────────────────────│
│ 640 words   4 matches   38% in  you are here │
└──────────────────────────────────────────────┘
```

Changes, each with its reason:

1. **`n of m` on the crumb line.** One number pair, and it is the one thing a proportional rail
   cannot show: how far through *this part* the band sits, as opposed to how far through the
   article. Costs no line. Omitted at `1 of 1`, which is a number you have to read before you can
   discard it.
2. **Each sub-section says what it is** rather than being a blank bullet — see above. `MAX_CHILDREN`
   stays at **5**, not the 4 the plan proposed, because the rows are one line each: the second
   dimmed gist line the plan wanted does not exist at that depth and never did. That also settles
   the review's other worry about this card, which was that four children at two lines each turns a
   scrub down the rail into a strobe.
3. **`you are here`** in the footer when the reader's current position is inside this band. It is
   the difference between reading the card as *what is over there* and as *what I am in*, and on a
   12px rail nothing else says it.

   **It needed new state, and the obvious version would have been wrong rather than approximate.**
   The rail already computes `here`, but `here` is an **L1** and the cards hang off `hits`, which
   are L2s — so a card asking "is my parent the current part" would say *you are here* on every
   sibling section of the one you are actually in. There is now a `hereHit` alongside `here`,
   transitioning on section boundaries rather than part boundaries: about fifty re-renders across an
   article rather than seven, which is still nothing beside the sixty-a-second the scroll effect
   exists to avoid. The same fact goes to a screen reader as `aria-current="location"` on the
   button, because the card is the button's *description* and it opens on hover, which a keyboard
   does not have.
4. **The part's own gist** is deliberately **not** added. Two gists in one card is the wall. The
   part's name plus `n of m` places you; if you want the part's gist you hover the part, which is
   what the rail's L1 bands are.

### Two things the review found that were not about the card at all

Both are lifecycle, both are the same seam as piece 1's regression at the other end of it, and both
now have a test that is red without the fix.

- **An armed band that stops existing.** `armed` is cleared by `onOpenChange`, which arrives from a
  *mounted* tooltip — so if the band under it disappears, no close ever comes and `armed` stays
  pointing at a band that is gone. Clearing it when the id leaves `hits` is half the answer; the
  half that bites is that **ids are positional within an outline**, so the same id in a *new* one is
  a different band, and a card opens by itself over a section nobody pointed at. Two effects, one
  for each.
- **A card a finger opened surviving a scroll.** Floating UI is not configured to dismiss on
  ancestor scroll here, so a touch-opened card rode up the screen while the article moved underneath
  it — and everything it says about position (`38% in`, and now `you are here`) quietly stopped
  being true. It closes on scroll now, on touch only: on a mouse the pointer is what holds it open,
  and closing it there would fight the reader.

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
| ToC only (stage 4) | crumb · `n of m` · title · gist · sub-section nav labels · footer |
| a part with one section | crumb with the part's name, **no `n of m`** |
| a childless part | crumb-less: title · gist · footer |
| a section with no sub-sections | no list at all, rather than an empty one |
| a child with neither title nor navLabel | dropped, and not counted in `+ n more` |
| a leaf with no gist | title · `navLabel` in italic (unchanged, and it stays italic — it is not a gist) |
| `words === 0` | no word count, rather than `0 words` |
| the reader past the end of the article | no `you are here` on any card, rather than on the last one |

Every row has a case in `tests/spine-card.test.tsx`, whose fixture is built to *contain* them — a
part with one child, a child with no label, a band with no word count — because the previous
fixture's `children: []` is exactly how the blank-bullet bug survived for a month.

### Reuse

The Outline-mode session wants a hierarchical hover card too. If piece 3 produces one worth sharing
it will be exported from `Spine.tsx` by name with its props, and offered to them before it is
written, so there is one of these rather than two.

---

## Evidence

- `tests/spine-hover.test.tsx` — eight cases against the real `<Spine>`. Two were red before piece
  1's fix. Two more were **passing for the wrong reason** and now advance past the 80ms exit
  transition before asserting, so neither can observe a card that is already dead; three are new and
  cover the lifecycle findings above.
- `tests/spine-card.test.tsx` — fifteen cases on what the card *says*, with a fixture shaped like
  real data and real row geometry, so the reading line actually falls inside a band.
- `tests/spine-width.test.ts` — the CSS/TS drift check. The stylesheet carries a
  `/* spine-width-check: GIST_MIN + PROSE_MIN + SPINE_W - 1 */` marker directly above each derived
  query and the test evaluates it against the constants, rather than grepping for a number — because
  a regex matches comments, and nudging a number only proves the regex sees that string.
- **Mutation-tested rather than assumed.** Every assertion above was watched going red against a
  deliberately broken version: eight mutations for the width sentinel (a rem creeping back, each
  query off by one, a deleted marker, `scroll.ts` left behind, `SPINE_W` moving alone), nine for the
  card, four for the lifecycle — each applied and reverted inside a single command, never across a
  boundary. One mutation was **not** caught on the first pass (falling back to `hits[0]` when the
  reading line is in no band), which is why there is now a case for reading past the end.
- **A browser pass, and it did not get the tab it needed.** Its first step was the visibility probe,
  and the probe failed: `visibilityState: "hidden"` throughout, with a dozen agent sessions sharing
  one Chrome profile. It fell back to a `requestAnimationFrame` shim. What that leaves standing is
  everything measured out of the DOM rather than out of a frame — and those are the checks a unit
  test genuinely cannot do: **`.spine` measures 12px**, the **732/731** and **844/843** crossovers
  both behave as the arithmetic says at exact element rects, the card's bullets have real text in
  them, and a mark measures **4px / 4px / 2.33px** at one, two and three searches, which is the
  formula exactly. What it does *not* stand for is anything about timing or animation: its "the card
  persists for 10s" was measured under the shim, not under a real compositor.
- GPT Sol on this plan before building (`spine-rail-review-sol.md`) and on the diff after
  (`spine-rail-code-review-sol.md`).

## Found on the way, not fixed here

**With the rail turned off, the mode band's two halves disagree across a 12px
band of widths.** `fitMode` crosses where the band and the prose stop fitting
side by side, and that depends on the rail — 844 with it, 832 without. The
stylesheet's covering rule is a plain `@media (max-width: 843px)` and knows
nothing about `?spine=0`. So between 832 and 843 with the rail off, the layout
reserves 288–299px for a band beside the prose while the stylesheet lays that
band over the whole window, on top of the space just made for it.

It is **pre-existing** — the same 12px gap sat at 844–855 when the rail was 24px,
and it is 12 wide *because* the rail is — so halving moved it rather than
creating it. It is not fixed here because the fix is not a fourth hand-copied
breakpoint: `App.tsx` already writes `--mode-w` from `fit.modeW`, so it can write
"there is no room for a band" as a class derived from `fit.modeW === 0` and let
the covering rules key off that instead of guessing from a width. That is a
change to `App.tsx`, which belongs to the mode band's owner, and it would delete
one of the six copies of this number rather than adding a seventh. Found by GPT
Sol, 2026-08-28; the arithmetic is in
[`layout.ts` § fitMode](../../src/web/layout.ts).

## Not doing

- **Bringing back a labelled rail at any width.** Deleted 2026-08-26 by Greg, and the reason it went
  is the reason a narrower rail is fine: names live in the card.
- **Making the card interactive.** Every tooltip on the page but the prose hover card is
  `pointer-events: none`, and a spine card that took hover would land under the pointer and keep
  itself open ([tooltips.md](../project/tooltips.md)).
- **Switching to Radix.** Unchanged from tooltips.md's verdict, and doing it in the same change as a
  regression fix would make it impossible to say which one moved the feel.
