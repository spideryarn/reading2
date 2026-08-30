# Sketch — a fifth diagram, drawn by a model rather than by an algorithm

> I've been disappointed by Diagram mode so far. Let's add a new kind of Diagram
> called "Agent's choice" (or come up with your own name), where the goal is to
> provide some kind of helpful sense of the whole document's structure. …
> if the writer says they're going to make 3 arguments for X, that might be
> represented as 3 columns that converge back. Or a list could be represented as
> rows, or an unordered set of ideas represented as a hub with orbiting radial
> connections. … I think don't use force-directed graph algorithms or anything
> like that. Let the agent decide the layout completely, probably with SVG.
>
> — Greg, 2026-08-30

The four pictures in [diagram.md](../project/diagram.md) each answer one question
with one algorithm — containment, physics, projection — and every one of them
draws the same shape whatever the article is. That is the disappointment. An
essay that makes three arguments for one conclusion and an essay that walks
through six unrelated topics come out of `tree` looking identical, because the
only thing `tree` knows is nesting.

**Sketch has no algorithm.** A model reads the article, decides what shape the
argument is, and lays it out itself.

It is called **Sketch** because that is what it is: drawn by hand, not to scale,
and an interpretation rather than a measurement. One syllable, like the four it
joins.

## The one thing that is not free

Greg asked for the layout to be entirely the model's, and it is. What is *not*
the model's is the **vocabulary it lays out in**. It writes a scene in five
primitives with numbers in them, and the numbers are checked before anything is
drawn.

That is the whole design, and the reason for it is already written down in
[diagram.md § What is deliberately not here](../project/diagram.md#not-doing),
where a generated image was considered and rejected:

> an image of a structure cannot be checked against the structure. A picture
> that puts section 4 inside section 3 is wrong in a way that looks exactly like
> being right.

Asking for raw SVG has exactly that problem and two more:

- **It would be the first model-authored markup this app renders.** Today there
  is none, and it is a stated rule in four files — `Cited.tsx`, `ChatPanel.tsx`,
  `citations.ts`, `CommentDialog.tsx` all say some version of *"this is model
  output; text is rendered as text, never `dangerouslySetInnerHTML`"*. The four
  real `dangerouslySetInnerHTML` sites are all article HTML downstream of
  `sanitizeArticle`. Making an exception here is a new precedent, and
  [security.md](../project/security.md) is emphatic that foreign content is
  where the mXSS bypasses live. It is also why there is no Mermaid.
- **Colour, type and the dark ground belong to the design system**, not to
  whatever the model happened to like. A scene carries a `tone` (0–7) and the
  stylesheet turns it into one of the eight positional hues, through the same
  `--cat-rgb` indirection the searches and the tree already use.

A scene keeps every bit of the freedom that matters — every position, shape,
grouping and line is the model's — and gives up none of that.

### The five primitives

`src/sketch-scene.ts`.

| | what it is |
|---|---|
| **node** | a shape with words in it. The only clickable thing. `box`, `pill`, `ellipse`, `diamond`, `hex`, `note`, `bare` |
| **region** | a labelled area behind the nodes: a column, a phase, a group |
| **edge** | a connector between two nodes, by id, routed by the renderer |
| **path** | a free `d` for what an edge cannot say — a funnel's walls, an arc, a loop |
| **label** | free text belonging to no node |

Anything drawable as a diagram of an argument is some arrangement of those. The
canvas is a fixed 760 units wide and a height the model picks, so the renderer
scales the whole thing by `viewBox` alone.

### What gets checked, and what gets measured

`readSketch` drops what cannot be drawn and **counts it**; it never repairs an
item into something plausible, because a validator that quietly patched things
would report a clean run on a model that cannot follow the schema
([silent-success.md](../reusable/silent-success.md)).

- a `block` the article does not contain costs the node its *click*, not its
  existence;
- an `opens` naming no scene, and an `edge` naming a node this scene has not
  got, are dropped;
- geometry a little off the canvas is **clamped**, not deleted — a box 20 units
  past the edge is a rounding error, and a picture with that box removed has a
  hole in it. Past a tolerance it is dropped and counted instead: clamping
  `x = -1,000,000` would draw a confident rectangle in the corner standing for
  something the model put somewhere else entirely;
- a node with no text, a second node sharing an id (an *ambiguous edge*, not a
  duplicate node), and an edge from a node to itself are all dropped;
- a `path`'s `d` is absolute `M L C Q A Z`, with the right number of arguments
  for each command, or it is not drawn. No relative commands: they compound, so
  one bad number moves everything after it.

Then `scoreSketch` measures four things. **None of them say the picture is
good** — they say it is not broken, and the pictures still have to be looked at.

- **flow** — Kendall's tau between a node's height on the canvas and where its
  block sits in the article. This is Greg's *"broadly preserve that the flow of
  the document is from top to bottom"* as a number, and it is the one property a
  beautiful picture can violate while looking perfect.
- **widest gap** — the longest run of the article no node points into. The
  obvious measure, "how many blocks are pointed at", is useless: sixteen nodes
  over a 141-block essay is 11% by construction. What a reader loses is a
  *stretch* they can scroll through with nothing lighting up.
- **overlap** — the *worst scene's* node area lying under another node. Pooling
  every scene let two tidy zooms dilute an overview drawn on top of itself, and
  the overview is the picture.
- **overflow** — nodes whose text will not fit the box the model gave them,
  asked with the same `wrap` the painter draws with.

And then `accept` decides whether any of it is a picture at all — see
[§ What GPT Sol's review changed](#what-gpt-sols-review-changed).

### One painter, two sinks

`src/sketch-paint.ts` turns a scene into drawing primitives, with no DOM. The
React panel maps a primitive to an element and hangs the handlers off the nodes;
the offline harness serialises the same primitives to a standalone `.svg`. A
painter in the panel plus a second one in the harness would be two answers to
one question, and the one that drifts is the one nobody is looking at when the
prompt is being judged.

## What it costs, and where it sits

**A model call, and not a small one.** Measured 2026-08-30 on the three articles
below: **$0.18–$0.25 and 125–145 seconds** each, at `capable`/`high`. That is
the most expensive thing in the reading view except ingest.

So, like Force, Drift and Trail: **on demand, never the default.** `tree` stays
the default for the reason `params.ts` already gives — *a default that bills the
reader for opening a mode is not a default*. It is a fifth `DiagramKind`, an
artefact, and a pipeline step off `DEFAULT_INGEST_STEPS`.

Registered so far (the experiment): `Task`, `TASK_TIER`, `TASK_WIRE`,
`MODEL_ENV_VAR`, `ArticleStage`, `STAGE_EFFORT`, `ARTICLE_RENDERER` in
`src/models.ts`, and `ChatJob`'s exclusion list in `src/ai-call.ts`. It sends
`articleWithIds` because every node names a block, so it shares no cached prefix
with arc, tweets or glossary — the same trade `ideas` makes. It *does* share one
with `ideas` itself, which agrees with it on both halves of the key (`high`,
`ids`); that is a real saving when a reader opens both, and a constraint, since
moving either stage's effort breaks it silently.

### The 288px problem, and the answer

The band is 288–400px. A structure diagram is not a strip.

So the band shows the **overview scaled to fit, as a thumbnail**, and an enlarge
button opens it full-screen in `Lightbox.tsx` — the same affordance a figure in
the article already gets (`src/web/zoomable.ts`). Zooming into a scene, which is
where this feature earns its keep, happens there.

## Interaction

- **Click a node with a `block`** → the article jumps there, through the same
  `onJump` every other picture uses.
- **Click a node with an `opens`** → the picture zooms into that scene. A
  breadcrumb goes back; Escape goes back.
- **Hover or focus** → the footer card shows the node's text, its `sub` and its
  `detail`, which is the sentence the box had no room for.
- **Keyboard** → same contract as the other four: one tab stop, arrows step
  through the drawn order and take the article with them, Enter jumps.
  It is a `listbox` of `option`s rather than a `tree`, for the reason Drift and
  Trail are: a scene is not a hierarchy and there is nothing to open. ← and →
  step within a row; ↑ and ↓ between rows.
- **`?diagram=sketch`**, and `?scene=<id>` for which scene is open. Unlike the
  Tree's collapse state, a scene id **is** safe in a URL: it is the model's own
  string, stored with the artefact, and it does not renumber.

## What three real articles produced

`npx tsx evals/sketch/run.ts`, 2026-08-30, the shipping prompt. Everything —
the raw model answers, the validated scenes, the PNGs and the numbers — is in
[`evals/results/sketch-2026-08-30/`](../../evals/results/sketch-2026-08-30/).

| article | nodes | linked | scenes | flow | widest gap | overlap | overflow | faults |
|---|---|---|---|---|---|---|---|---|
| noema-mythology-of-conscious-ai | 34 | 34 | 3 | 0.95 | 9% | 0% | 0 | 0 |
| constitution | 32 | 32 | 3 | 0.95 | 16% | 0% | 0 | 0 |
| scaling-hypothesis | 25 | 25 | 3 | 1.00 | 25% | 0% | 0 | 0 |

The shapes it chose, in its own captions:

- **Noema** — *"A funnel of psychological biases and a convergence of four
  philosophical arguments both feed into one guarded conclusion … which loops
  back to the essay's opening plea."*
- **Constitution** — *"a four-rung priority ladder (safety > ethics > guidelines
  > helpfulness), then walks through the document elaborating those same rungs
  in reverse order of rank."* The picture draws the two stacks side by side with
  matching hues, so the reversal is visible without reading a word. Nothing in
  this app could have found that.
- **Scaling hypothesis** — *"A long descending spine … which is vindicated by a
  decade of failed skepticism, and finally pivots."*

### Five renderer bugs the first pictures found

All of them invisible as code and obvious as a picture, which is the argument
for the harness.

1. **Everything rendered black.** `librsvg` does not resolve CSS custom
   properties, so `rgb(var(--sk) / 0.15)` is an unparseable colour, and an
   unparseable fill paints black on a near-black ground. The harness now writes
   the palette out; the app keeps the indirection.
2. **A fan of children came out sideways.** `facing()` compared centre offsets,
   so one node pointing at three spread below it left through its own left and
   right sides and arrived at them pointing inwards. Every line was
   geometrically reasonable and none read as the argument moving forwards. The
   rule is now: **if one shape is entirely below the other, the edge is a
   descent**, before any comparison of dx against dy.
3. **A loop back to the opening went straight through nine boxes.** The model
   did the right thing and aimed both ends at their nodes' left sides; a fixed
   46-unit control offset against an 1,100-unit chord is a straight line. The
   pull now scales, and differently for anchors that face each other than for
   anchors on the same side.
4. **Curves walked off the canvas and back on.** A 300-unit wrap-around pull off
   an anchor near the left margin puts a control point at x = −130. Nothing
   clips. Control points are clamped now, which clamps the curve — a cubic never
   leaves its control polygon's hull.
5. **Captions ran off the right edge** with no error, twice: `sceneSvg` kept the
   unwrapped version for a round after `sketchSvg` was fixed, so the per-scene
   images clipped while the stacked one did not. SVG does not wrap and does not
   complain, which is the same trap `diagram.md § Two things that are wrong in a
   way you cannot see` already records.

## What a reader who had not read the articles made of them

A Sonnet subagent was given the three overview PNGs and **nothing else** — no
outline, no summary, not even the articles' titles beyond what the pictures say
— and asked what each piece argues, what shape it is, and where it would click.
Then it checked two of them against the real outlines. 2026-08-30.

**It read all three correctly.** On the Noema essay, from the picture alone:
*"AI probably isn't conscious yet, people are fooled into thinking otherwise,
and treating it as conscious (or building it to be) is dangerous."* On the
scaling hypothesis: *"GPT-3's results show that scale alone produces
intelligence, and this will keep paying off if anyone commits to pushing it
further."* Both are the article. That is the thing this feature is for, and it
is the first evidence that it works.

**Fidelity held, and the losses are compression rather than invention** — which
is the distinction that matters, because a picture that invents an argument is
worse than no picture. Two were found, and both are real:

- The Noema picture draws the two ethical risks as **symmetric alternatives**,
  where the article argues the bias is *asymmetric* — "human biases toward AI
  are more likely to produce false positives than false negatives". The picture
  flattens an emphasis the piece actually makes.
- The scaling picture's single box *"Critics keep being wrong"* carries one of
  the two arguments in that section and drops the other — the philosophical one
  about reductionist dismissal.

Neither is a fabricated relationship. Both are a 25-node picture of a 300-block
article doing what a 25-node picture does. Worth knowing rather than fixing.

### Three findings acted on

- **A connector crossing a region's own name** made it impossible to tell
  whether the line terminated there. Called the single most valuable change.
  A region's *panel* belongs under the edges, the way a background does; its
  *name* does not. Fixed — words on top, panel underneath.
- **On the constitution, colour was decoration.** Every box a different hue with
  no key, which is precisely the misuse [colour-scales.md](../project/colour-scales.md)
  forbids: a reader looking for what the hues mean finds there is nothing to
  find, and stops trusting the ones that do mean something. The other two
  pictures used two and three groups and the evaluator called the colour there
  "doing real work". The prompt now says so in those words.
- **The constitution's chain hid that it was a list of elaborations.** Its boxes
  restate the four priorities set out above them rather than following from
  them, and drawn as one descending chain that has to be read box by box to see.
  Not fixed — it is a prompt problem and the honest test is whether the next
  draw does better.

### And two left open

- **No key to the shapes.** *"No legend says what hexagon-vs-rectangle-vs-diamond
  means."* True, and a legend costs canvas that the picture is using. The likely
  answer is the footer card rather than a legend, since the shapes are a
  convention (diamond = a question, note = an aside) rather than a code.
- **A long dashed connector is easy to lose**, even with a label on it. The
  label sits on the line and the line is faint; the eye does not always join
  them.

## What GPT Sol's review changed

The plan and the built code went to `gpt-5.6-sol` at high effort
([the prompt](sketch-diagram-review-prompt.md),
[the answer](sketch-diagram-review-sol.md)). Its verdict was **do not
product-integrate this yet**, and it found one thing that would have shipped a
blank picture as a success. Everything below is fixed and tested unless it says
otherwise.

**The one that mattered.** A model answering `{"scenes": []}` came through
`readSketch` with **zero faults**, scored, and was written to disk as a finished
sketch. The reader would have opened Diagram, waited two minutes, been billed,
and been shown nothing — with every check reporting success. `OVERVIEW_MIN` was
advice inside a prompt, which is not a rule. There is now an `accept` boundary
in [`sketch-scene.ts`](../../src/sketch-scene.ts) and `generateSketch` throws
rather than writing anything that fails it: an overview under three nodes, no
caption, fewer than half its nodes clickable, more than a quarter of its area
drawn over itself, or a flow under 0.3. **Deliberately not a quality bar** — no
arithmetic here can tell a good picture from a bad one — it is the line under
which there is no picture at all.

**Six more real defects in the built code**, every one of them invisible:

- **The validator was not the validator its own comments described.** Unknown
  enum values were silently defaulted, so a model that had started writing
  `"shape": "trapezoid"` produced plain boxes and a fault list of length zero.
  Now counted. Regions were clamped by each number independently, so `x=750,
  w=100` survived on a 760-wide canvas and drew a band 90 units off the edge —
  the same mistake the node reader had already been fixed for. Duplicate node
  ids (an *ambiguous edge*, not a duplicate node), self-edges, and empty node
  text all survived. And clamping was unbounded: `x = -1,000,000` became a
  confident rectangle in the corner. There is a tolerance now — clamp a near
  miss, drop and count anything further out.
- **`cleanPath` was injection-safe and not a parser.** `M10 10 L100` passed with
  a dangling `L`, which browsers disagree about. Arity is checked per command
  now. (The `/i` flag that let *relative* commands through had already been
  caught, by a test, an hour earlier.)
- **The sixth renderer bug: the control-point clamp was on one axis, and so was
  the test written to prove it.** An edge `a:top → b:top` off a node near the
  top of the canvas put a control point at y = −137 and the curve left through
  the ceiling — guard and probe both reporting success. Two clauses need two
  probes.
- **`nodeFits` and `wrap` were two different wrapping routines and they
  disagreed.** A 60×20 node holding one long word scored as fitting and rendered
  as `superc…`, so `overflowing` reported 0 for a picture with a truncated node
  in it. There is one `wrap` now, in `sketch-scene.ts` beside the `nodeFits`
  that has to agree with it, and a test asserts the two agree as a *property*
  rather than on one example.
- **A free path ignored `arrow: "start"` and drew one head for `"both"`** — an
  arrow that silently does not appear, on the primitive whose whole purpose is
  the shapes an edge cannot make.
- **An end-aligned free label measured its room to the right**, so one near the
  left margin was told it had the whole canvas and ran off the edge.

**Two measures were wrong about their own definitions.** `reach` counted the
*distance* between marks rather than the blocks with no mark, so a sketch with
no linked nodes at all reported 90% of a ten-block article unreached instead of
100% — the worst possible input scoring better than it deserved. And `overlap`
was pooled across scenes, so two tidy zooms could dilute an overview drawn on
top of itself. It is the worst scene's now.

**Provenance was missing entirely.** No `sourceHash`, no `profileHash`, and
`PROFILE_RULES` never reached the prompt, so the stage could not tell a current
sketch from one drawn against an article that has since been re-ingested. Both
hashes are on the artefact now, and the source hash covers the tree as well as
the blocks for the reason [`ideas.ts`](../../src/ideas.ts) gives: the prompt
shows the model the outline, so re-cutting the sections changes the question
while every block stays byte-identical.

**And the evidence was not reproducible.** The harness saved the *cleaned*
scene, so `--render` revalidated already-validated data and reported it
spotless — a fault count that cannot be reproduced is a claim, not evidence. The
raw answer is written beside it now, and the whole run is committed under
`evals/results/`.

### And a seventh renderer bug, found by drawing a different genre

Every article in the table above is an argumentative essay, and a corpus that
cannot exercise a rule tells you nothing about it. So two more were drawn:
`fowler-phrenology`, an 1849 lecture that is really a list of twelve benefits,
and `revistes-ub-30977`, a literary-studies paper. Both came back with a real
shape — a funnel into a fan-out into a convergence, and a chain that loops back
— and the phrenology one scored **flow 0.74**, the lowest yet and correctly so:
its five domains are a genuine fan rather than a sequence.

What they exposed is that **`nodeFits` was measuring the bounding box, and a
diamond, a hexagon, an ellipse and a pill are all narrower than their box away
from the centre line.** The phrenology hexagon was captioned *"self-knowledge to
moral perfection"* with the caption crossing both of its sloping sides, and
`overflowing` reported **0** — which is exactly the failure this module exists
to catch, in the module that catches it. Three of the five earlier pictures had
the same fault and none of them had reported it.

`widthAt` computes each outline's real width now, and `layoutNodeText` is a
single function that returns the text as it will be drawn, so the painter
positions what the measure measured. **Two rounds of this were the same
mistake**: first two different word-wrapping loops, then two different ideas of
how wide the shape is. A measure and the thing it measures cannot be two pieces
of arithmetic.

One piece of that arithmetic is worth naming because it was wrong in a way that
looked right: the width has to be taken at the **outermost line's centre**, not
at the edge of the text block. Measured at the edge, a three-line block is
narrower than a two-line one, so the text needs another line, so it is measured
narrower still — the passes diverge, and the measure invents the truncation it
was added to detect.

### Known and not fixed: edges cross boxes

On the phrenology fan-in, the curve from *Business and vocation* down to the
conclusion passes straight through *Justice, law, marriage*. Nothing routes
around obstacles; an edge is a curve between two anchors. Fixing it properly
means obstacle-aware routing, which is a real piece of work and the wrong thing
to build before anyone has used this. The cheap mitigations already in are that
edges are drawn *under* the nodes, so a box is never obscured, and that edge
labels move along the line to a clear spot.

### Findings taken as fair and not acted on

- **`flow` overclaims.** It is ordinal: three nodes at y = 100, 100.001 and
  100.002 score 1 and are one visible row. It is also blind to edge direction,
  crossings, and whether a box's words are true of the block it links to. All
  correct. It stays as it is because it catches the one failure it was built for
  — a picture that does not run down the page — and the honest fix for the rest
  is a person looking at the PNG. (One sub-claim was wrong: parallel premises
  sharing a row are not penalised. `tau` here is tau-b, which takes ties out of
  the denominator rather than counting them against.)
- **"The prompt is selecting from a menu."** All three shapes it produced —
  funnel, ladder, spine — are named in the prompt, with worked coordinates, and
  there is no lighter-prompt arm showing the examples help rather than anchor.
  That is a real gap in the evidence and it is now the first open question for
  Greg rather than something to quietly fix. The self-contradicting hub example
  *was* fixed: a full ring cannot keep article order down the page, because half
  of it runs upwards, so it is a half-ring now.
- **Accessibility** needs a stored textual description of the graph, not ARIA
  on nodes inferred from coordinates. Correct, and it belongs to the
  integration rather than to the experiment.

## Open for Greg

- **Does the prompt's menu of shapes help or anchor?** Sol's sharpest question,
  and the one piece of evidence this experiment does not have. Every shape the
  model chose was one the prompt named. The arm to run is the same three
  articles with the shape list and the worked coordinates removed — if the
  pictures are as good, the prompt is half its length and the model is really
  choosing; if they fall apart, the examples are doing the work and should stay.
- **Is $0.20 and two minutes worth it?** It is four times the glossary. The
  cheaper arm to try is `medium` effort, or feeding the model the tree and the
  summary *instead of* the whole article — untested, and it would lose the
  block-level anchors.
- **Three scenes, always?** The prompt currently asks for an overview plus two
  zoom-ins. On the constitution both zooms earned their place; on a short piece
  they may be padding.
- **Does the thumbnail-plus-lightbox trade work**, or should Sketch take the
  whole width when it is open? Sol's answer is that it should not be a fifth
  chip at all but an "Article Map" launched *from* Diagram, on the grounds that
  its cost, latency, required width and drill-down interaction are all
  materially different from the other four. That is a product call.
- **A node may carry both a `block` and an `opens`, and the plan did not say
  what clicking it does.** Proposed: `opens` wins on click, and the footer card
  gets an explicit way to the text — so the picture's own gesture is "go deeper"
  and the article jump is always available but never a surprise. Sol flagged the
  ambiguity; the resolution is a guess until somebody uses it.

## Not doing

- **No raw SVG from the model.** See above; it is the whole design.
- **No second call to lay out a zoom on demand.** All the scenes come back in
  one answer. Cheaper per picture and it is what makes `opens` checkable.
  **Sol argued both sides of this and they conflict**: generate the overview
  first so the reader waits 60 seconds rather than 140, *and* cut the
  pre-generated zooms entirely as the one thing to drop. They cannot both be
  right, and which one is depends on whether a reader opens a zoom — which
  nothing here knows yet. Left as it is until somebody has used it.
- **No re-layout to fit the band.** The renderer scales; it does not re-flow.
  Re-flowing would mean the model's layout was a suggestion, and it is not.
- **No overlap repair.** If a model puts two boxes on top of each other, that is
  measured and shown, not nudged apart. A layout the renderer half-owns is a
  layout nobody owns.
- **Nothing shared with the other four pictures' geometry.** `sketch-paint.ts`
  imports nothing from `diagram.ts`. They have `wrapText`'s character-counting
  trick in common and nothing else, and both files say so.
