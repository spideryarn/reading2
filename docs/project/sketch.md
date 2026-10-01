# Sketch

Up: [reading-view-overview.md](reading-view-overview.md)

One of Diagram mode's pictures, and the default one: a model's drawing of the shape of the argument.
It moved here from [diagram.md](diagram.md) on 2026-10-01 with its wording kept; the mode, the chips
and the other pictures are still there, and so is
[what a visitor gets](diagram.md#a-visitor-gets-the-sketch-and-only-the-sketch).
[Illustrated](illustrated.md) is this picture, painted.

> I've been disappointed by Diagram mode so far. … the goal is to provide some
> kind of helpful sense of the whole document's structure. … if the writer says
> they're going to make 3 arguments for X, that might be represented as 3
> columns that converge back. … Let the agent decide the layout completely.
>
> — Greg, 2026-08-30

The three computed pictures in [diagram.md](diagram.md#the-three-computed-pictures) each answer one question with one algorithm, so every
article comes out the same shape. **Sketch has no algorithm**: a model reads the
piece, decides what shape the argument is — a funnel into a convergence, a
priority ladder beside its own elaboration, a spine with asides — and lays it out
itself. On the constitution it drew the four values beside the four body
sections in matching hues, so the reverse-order correspondence is visible without
reading a word. Nothing else here could have found that.

The whole design, the measurements, the review it survived and what a reader who
had not read the articles made of the pictures are in
[260830j-sketch-diagram.md](../plans/260830j-sketch-diagram.md). What follows is what the reader
touches.

## It does not emit SVG, and that is the design

The model writes a **scene** in five primitives with numbers in them —
[`src/sketch-scene.ts`](../../src/sketch-scene.ts) — and the numbers are checked
against the article before anything is drawn. Every `block` id has to exist,
every edge has to name a node this scene has, every path is `M L C Q A Z` with
the right arity, and the picture is *measured*: whether it still runs down the
page with the article, how much of the piece nothing points into, how much of it
is drawn on top of itself, how much text will not fit its shape.

That is what makes it a different answer from the generated image
[§ What is deliberately not here](diagram.md#not-doing) rejects, rather than the same one
again — *an image of a structure cannot be checked against the structure*, and a
scene can. It is also why this is not the first model-authored markup the app
renders: there still is none.

**The layout really is entirely the model's.** Every position, shape, grouping
and line. What it does not get is the vocabulary, the palette or the type scale,
and a `tone` is a group marker that the stylesheet turns into one of the eight
positional hues through the same `--cat-rgb` indirection everything else uses.

## Where the pieces are

| | |
|---|---|
| the schema, the validator, the score, the acceptance boundary | [`src/sketch-scene.ts`](../../src/sketch-scene.ts) |
| scene → drawing primitives, no DOM | [`src/sketch-paint.ts`](../../src/sketch-paint.ts) |
| the prompt and the model call | [`src/sketch.ts`](../../src/sketch.ts) |
| the panel | [`src/web/SketchView.tsx`](../../src/web/SketchView.tsx), [`useSketch.ts`](../../src/web/useSketch.ts), `§ sketch` in [`styles/diagram-sketch.css`](../../src/web/styles/diagram-sketch.css) |
| the harness that renders one offline | [`evals/sketch/`](../../evals/sketch/) |

**One painter, two sinks.** `sketch-paint.ts` is pure and returns primitives;
the panel maps each to an element and hangs the handlers off the nodes, and the
offline harness serialises the same primitives to a standalone `.svg`. A second
painter in the panel would be two answers to one question, and the one that
drifts is the one nobody is looking at when a prompt is being judged.

**Its own component, not a fourth branch of `DiagramPanel`.** The other three
are a `DiagramLayout` and every control under the chips is about it — the roving
tabstop over `layout.nodes`, the step bar over its ladder, the footer card over
a `SummaryNode`. A scene is none of those and has its own. Splitting once, below
the chip row, is what keeps the other three unbraided.

## The scene is checked again in the browser

`readSketch` runs on the server before the artefact is written **and** in
[`useSketch.ts`](../../src/web/useSketch.ts) when it arrives. That is not a
duplicate. What comes back from `/api/sketch/:slug` is a stored artefact that may
have been written by an older schema, or against an article that has since been
re-ingested and has different block ids — so the panel drops what it cannot draw
before drawing anything, and what it drops is the *unreachable*, never the
picture. An unknown block id costs a node its click and leaves the node standing.
The count comes back so the reader can be told the picture is older than the
article, rather than being quietly handed a diagram whose clicks do nothing.

It is the same rule at both ends of a wire that has a database and a year in the
middle of it. The same pass is where a region's door gets *derived* when the
model did not write one, which is why both ends of that wire agree about which
names are pressable without the artefact on disk having to change.

**Reachability is two numbers, and they answer different questions.** A scene
nothing opens is a scene the reader can never get to — the plainest silent
success this feature produced, unnoticed through six runs, and the reason
`score.unreachable` exists at all. But once a link can be inferred, that one
number stops being able to say whether the *prompt* is still working: a picture
whose doors we fitted ourselves scores exactly like one the model wired
properly. So `unreachable` counts what the reader cannot reach, inferred doors
included, and `score.inferred` counts how many of the doors are ours. Watch the
second one: it rising is the prompt quietly giving up on `opens`, and nothing
else would show it.

## What it costs, and what that decides

**The effort is `low` since 2026-10-01**, down from `high`. Eight articles, two
draws per arm, two blind judges (GPT Sol ranking, Opus scoring): no visible loss
(mean U 1.56 and 1.69, where 2.0 is no difference), and a call went from $0.235
to $0.100 and from 176 s to 42 s on average. Validity was 1 malformed draw in 16
at both levels. It also took the Sketch out of the `ids` cache group — see
[prompt-caching.md](prompt-caching.md).
[261001c](../research/261001c-thinking-effort-vs-quality-for-sketch-illustrated-hierarchy-ideas.md)
has the lineups and what the judges said. The figures in the next paragraph are
from the `high` era; the consequences below are weaker at a quarter of the time,
but none has been undone.

**One model call, 121–194 seconds, about $0.20** — measured over seven draws of
five articles. That is the slowest single thing in the app and four times the
glossary, and three consequences follow from it rather than from taste:

- **Never run by the pipeline, and never in an ingest.** `sketch` is off
  `DEFAULT_INGEST_STEPS` and in `FORCE_ONLY_WHEN_NAMED`, so nothing sweeps it in.
  It became the *view's* default on 2026-09-04 — the picture Diagram opens on —
  which is a different thing and buys nothing; see
  [Who sees which chip](diagram.md#who-sees-which-chip-2026-09-04).
- **Picking the Sketch chip draws it, if nobody ever has.** Since 2026-09-02,
  and it is the chip's `onClick` that arms it, never `?diagram=` — that is query
  state, so Back and Forward move it, and a pasted
  `?mode=diagram&diagram=sketch` must not buy a two-minute call. *Opening
  Diagram costs nothing*: with nothing drawn the mode lands on the empty state
  below, so the bar's Diagram button arms nothing at all — `diagram` is
  deliberately absent from `MODE_TARGET`, and that mattered more from 2026-09-04,
  when the button went into every reader's bar.
  [`src/web/activation.ts`](../../src/web/activation.ts),
  [`useAutoRun.ts`](../../src/web/useAutoRun.ts), and
  [glossary.md § That decision was reversed](glossary.md#that-decision-was-reversed-on-2026-09-02-and-the-loop-is-still-closed-structurally)
  for the loop it has to close and how. One automatic attempt per article per
  tab session; the button is the only retry.
- **`useSketch` grew a second verb for it.** `ensure` is unforced and is what
  both the automatic draw and the empty state's button call — a forced press
  landing inside the automatic start's window would be a different `work_key`,
  which stage 1 does not de-duplicate, and the reader would pay twice.
  `regenerate` is forced and keeps the reasoning the old single verb had: a
  redraw is offered beside a picture that is current, where an unforced run
  would skip while the reader watched two minutes go by.
- **The empty state says the price before the press**, not after it — a reader
  who presses a button and then watches a spinner for two minutes with no idea
  why is owed the sentence.
- **And a redraw somebody else started still shows.** `useStepJob` reads the
  queue rather than remembering the click, precisely so a run from the CLI, the
  shelf or another tab appears — and this panel was the one surface that did
  nothing with the answer, so a picture already on screen changed under the
  reader two minutes later with nothing having said it would. `.sk-busy` is one
  line with the spinner and the step's own label. Deliberately **not**
  `JobProgress`: that row carries a Stop button and, with no job running, the
  Draw button — and offering a $0.20 redraw beside a picture that is already
  there is a product decision, not a loading state.
  [`tests/sketch-view-drawing.test.tsx`](../../tests/sketch-view-drawing.test.tsx).
- **It is in `FORCE_ONLY_WHEN_NAMED` for a third reason the others do not have**,
  and it is about the clock rather than the money: every step self-aborts at 400s
  inside an 800s invocation that must also fit a `hierarchy` measured at 320s. A
  positional cascade that swept this in beside `hierarchy` would not *merely* waste
  a call, it would run the invocation out of time — and that fails as a platform
  kill that takes the whole job rather than as a recorded failure. (The *merely*
  went missing here and nowhere else, which inverted the sentence;
  `src/pipeline.ts` § `FORCE_ONLY_WHEN_NAMED` has always had it.)

**The first converted step, and for a while the only one.** Writing a file inside
`run()` works on a laptop and cannot work through a store that puts the artefact
in a Postgres column. `generateSketch` writes nothing and hands the scene back;
the step returns it as `parts`, and `evals/sketch/run.ts` writes it into a results
directory. Every other article-reading stage followed on
2026-08-31 — [260831b-finish-the-database-move.md § Stage 2](../plans/260831b-finish-the-database-move.md).

## 288px is not a size a diagram fits in, and zooming inside it does not help

The canvas is 760 units and the band is 288–400px, so scaled to fit, 12-unit text
lands at about 5px. The band shows the **shape**, which is what this picture is
for and which survives being small; the words do not, so hovering or focusing
anything puts the full text in the card underneath.

The first answer to the words was a Fit/Read toggle that redrew the picture at its
natural 760 units *inside the same column*. Greg, 2026-08-30:

> Right now it just zooms in, but the column is narrow.

Which is the whole objection. Reading a diagram through a 288px slot by scrolling
it in two directions is worse than not reading it: you lose the shape, which was
the one thing the small version had, and you gain words you have to reassemble
from four screenfuls.

So **Enlarge**, and it is a real modal — the same `<dialog>` `showModal()`
[`Lightbox.tsx`](../../src/web/Lightbox.tsx) uses for a figure in the article, for
the four reasons that file gives: Escape closes it, the background goes `inert`,
focus is trapped and restored, and it paints in the top layer without joining the
z-index budget. Inside, the picture is drawn to the window's width rather than to
760, so the text arrives at 17–20px and the shape is still whole — nothing about
the layout changed, only its scale.

**A press on the picture's background is Enlarge too**, in the band — Greg,
2026-09-11 (`spya-mghbv7`). A node still selects and a region's name still opens a
scene; only a real pointer press counts, never the listbox's keys or the end of a
selection drag; and the second click of a double-click does not shut what the first
opened ([`enlargePress.ts`](../../src/web/enlargePress.ts),
[261001l](../plans/261001l-compact-quotes-and-citations-band-tops-and-click-a-diagram-to-enlarge.md)).
Illustrated's plate does the same.

**Widening the column was the other option Greg offered and it is worse.** The
band's width is the output of a negotiation in
[`layout.ts`](../../src/web/layout.ts) between the rail, the band and
`PROSE_MIN`, and a band that grew to fit a diagram would take that width from the
article — which is what the reader is here to read, and what every other rule in
that file protects first. A modal takes it from nothing.

## Interaction

- **Click a node** → if it has an `opens`, the picture zooms into that scene;
  otherwise the article jumps to its block. **`opens` wins**, because the
  picture's own gesture is "go deeper" and a click that sometimes zoomed and
  sometimes scrolled the article would be a control nobody can predict. The jump
  is still there, from the card, where it is labelled — available and never a
  surprise.
- **A part that opens says so, and shows what is inside it.** A zoomable region
  is drawn *hotter* than one that is not — a brighter edge, a stronger wash, on
  its own panel. Contrast rather than a second shape, because the band scales
  760 units into under 400 pixels and every **distance** halves with it: the
  first version was a second panel offset five units behind the first, which is
  two and a half pixels, and a browser pass could not see it at all. Beside the
  name there is an "expand" corner mark, held at a constant stroke weight so it
  is the same line in the band as at full screen. Hover or focus the name and
  the scene it opens is
  drawn *inside that region*, small, over a scrim — the real scene, painted by
  `paintScene` into a nested viewport, with only the words dropped. Press it and
  the new scene grows out of the box you pressed; Back reverses the same motion.
  All of it is [260830ap-sketch-zoomable-subsections.md](../plans/260830ap-sketch-zoomable-subsections.md),
  including why the ghost is not a simplified redraw and why the swap happens
  before the animation rather than after it.
- **Click a region's name** — "WHY WE'RE TEMPTED TO SEE IT" — and the picture
  opens the zoom scene for that part. Greg asked for it by example, and it is the
  most natural handle there is: a region is the overview's own statement that
  these boxes are one movement of the piece, and the zoom is that movement drawn
  larger, so a reader pressing the name is pointing at exactly what they want
  more of. **The name, never the panel**: a region is a large area lying *behind*
  the nodes, and making all of it pressable would put a second meaning on every
  pixel between the boxes.
- **The name is pressable even when the model never said so.** Greg pressed
  "WHY WE'RE TEMPTED TO SEE IT" and nothing happened: that drawing was made
  before the prompt asked for `opens`, and the region carried none. Redrawing
  costs $0.20 and fixes one article, leaving every reader holding an older
  sketch pressing names that do nothing — so the link is *derived* instead.
  `inferRegionOpens` in [`src/sketch-scene.ts`](../../src/sketch-scene.ts) reads
  the blocks under the region and the blocks in each zoom scene, and joins them
  when one scene takes a strict majority of the region's and the runner-up takes
  at most half of that. It is deliberately shy — **a wrong door is worse than
  none**, because a reader who presses a name and lands somewhere else has been
  lied to by the picture, where one who presses a name and gets nothing has
  learnt only that this name is not a control. On the six regions of the two
  real drawings it links three and abstains on three, and all six are right. Not
  string similarity: "THE CORE ARGUMENT" and "Why Scale Works: The Ladder" share
  no word, and their blocks match five to nil. A link the model wrote is never
  overruled, and a derived one is **not saved**: `stripInferredOpens` takes it
  back out before the artefact is written, so the stored picture stays the
  model's own work and the derivation runs afresh on every read — which is also
  how a better rule tomorrow reaches every sketch already on disk. A derived one
  is marked `opensInferred` — see
  [§ The scene is checked again in the browser](#the-scene-is-checked-again-in-the-browser)
  for why the score then needs two numbers rather than one.
- **Back** appears whenever a zoom is open, and Escape does the same. The scene
  row beside it is the other way around the picture — Back is out of where you
  are, the row is a list of where you could be — and neither depends on the model
  having wired an `opens`, which on four of the first six drawings it had not.
- **Hover or focus** → the card below. Fixed height, like `.diag-card` and for
  the same reason: a card that grew with its text would resize the picture above
  it every time the pointer crossed a box.
- **Keyboard** → one tab stop, arrows inside it, Enter activates. A `listbox` of
  `option`s rather than a `tree`, for the reason Drift and Trail are: a scene is
  not a hierarchy and there is nothing to open.
- **Where you are** is a ring on the deepest node at or above the reader's row,
  and only on the overview — marking a position inside a zoom scene when the
  reader is elsewhere would be a confident lie about where they are.

## The shapes make claims, and the prompt says so

The failure this picture has that none of the other three can: **it asserts
things through its geometry that nobody wrote in words, and those assertions can
be stronger than the article's.** Found twice by readers shown only the pictures
— a numbered priority ladder on a document that says its order is "holistic
rather than strict", and a decision diamond on a question the essay says cannot
be settled. Neither was a wrong fact; both were the shape being more confident
than the prose, and a reader cannot tell a confident drawing from a correct one.

`SYSTEM` in [`src/sketch.ts`](../../src/sketch.ts) now names what each device
claims, before the canvas and before the primitives, and asks the model to check
each shape it used against the article. It is the most load-bearing section of
that prompt.

---

Up: [reading-view-overview.md](reading-view-overview.md) · the other pictures: [diagram.md](diagram.md)
