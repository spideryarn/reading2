# Outline mode — the whole document in one list, detailed where you are

**Status: planned, not built.** An eighth mode in the band between the spine and the prose
([reading-view-overview.md](../project/reading-view-overview.md)): one nested list of the entire
document, which never scrolls, and which spends whatever vertical room it has on the part of the
document the reader is standing in.

## What Greg asked for

> So right now, we have multiple columns in our contents mode and I'd like to try adding a new mode.
> I'm going to call it fish eye mode, and basically the idea would be that it takes up the entirety
> of the vertical space that's allowed for that mode and it shows the hierarchy of our table of
> contents that we've generated. […] the idea would be that it tries to maximize use of the space
> available and that it provides more granularity for the bit that you're on at the moment. So the
> bit that you're on at the moment might get a longer description and the bits either side get
> shorter descriptions, but it always shows you the whole structure of the document. So in other
> words, given the vertical space available, it dynamically adjusts and it always shows you the whole
> document structure and it zooms in on where you are right now. It's sort of dynamic. I call it
> fisheye mode for the obvious reason that the higher granularity follows your position around.
>
> — Greg, 2026-08-28

And the problem it is for, which is the part that decides the design:

> right now, I don't know, the context modes are a bit confusing and busy and I can't always see the
> whole picture somehow. That is, in the whole document structure. I can't tell where I am in the
> grand scheme of things and I find it confusing to move visually left and right. So I was wondering
> if there's a way to cram it all into one.
>
> — Greg, 2026-08-28

## Why this is not something we already have

Three existing things claim a piece of it, and naming what each one *doesn't* do is what defines the
work.

- **The gist columns already fisheye — but each one on its own.** Every coarse column is drawn by a
  fixed full-height panel listing the whole of its level, current item on a focus line 40% down,
  never scrolling ([column-context.md](../project/column-context.md)). So "the whole level, centred
  on you, filling the height" is built three times over. What it does not do is *nest*: three
  parallel lists at three resolutions, side by side, with no line drawn between a section and its
  part. The nesting is real — children exactly partition their parent
  ([granularity-zoom.md § the tree](../project/granularity-zoom.md#the-tree)) — and the layout never
  shows it. That is what "confusing to move visually left and right" is describing.

```
  ┌──┬──────────────┬──────────────┬──────────────┬────────────────────────┐
  │sp│  Arg  (L0)   │  L1 (parts)  │ L2 (sections)│  the prose             │
  │in│              │              │              │                        │
  │e │ 1/5 …        │ 1 What feel… │ 1.1 The body…│  Being You opens with  │
  │  │ 2/5 …        │ 2 The body … │ 1.2 Why col… │  a story about waking  │
  │▇▇│ ┌──────────┐ │ ┌──────────┐ │ ┌──────────┐ │  from anaesthesia, and │
  │▇ │ │3/5 Brains│ │ │3 Why col…│ │ │2.3 The   │ │  what that tells us    │
  │▇▇│ │are not   │ │ │our is a  │ │ │dress,    │ │  about the self…       │
  │▇ │ │Turing …  │ │ │guess     │ │ │again     │ │                        │
  │▇▇│ └──────────┘ │ └──────────┘ │ └──────────┘ │  Every paragraph stays │
  │▇ │ 4/5 …        │ 4 The self … │ 2.4 What the…│  exactly where it was. │
  │▇▇│ 5/5 …        │ 5 Being a …  │ 2.5 Colour …│                        │
  └──┴──────────────┴──────────────┴──────────────┴────────────────────────┘
        THREE complete lists, each centred on you, none of them nested.
```

- **Summary mode is about 80% of this** ([summaries.md](../project/summaries.md)): an indented
  outline of the whole tree in the band, a `DEPTH` cut-off, `+N sections` badges, a strong "you are
  here" mark on exactly one row, and it scrolls itself to follow the reader. What it does not do is
  vary detail *by distance* — its `LENGTH` ladder is one rung for every row at once — and it is a
  list the reader scrolls, not a picture that is always wholly present.
- **The table with the prose hidden (`?text=0`)** is already a whole-article outline at a glance.
  What it does not do is coexist with the article, and
  [granularity-zoom.md](../project/granularity-zoom.md#both-at-once-the-paragraph-outline-beside-the-prose)
  states plainly why that cannot be fixed inside a shared-row table.

- **Diagram mode's tree picture is the fourth surface, and the first draft of this plan missed it.**
  Found by GPT Sol's review. `?mode=diagram` with the tree picture already gives a nested, ordered,
  clickable tree of the whole article with the current position marked, in this same band
  ([diagram.md](../project/diagram.md)). What it does not do is expand itself around the reader or
  promise to fit — it is a picture you scroll and steer, not one that follows you. That is a real
  difference, but it is narrower than the first draft of this plan implied, and the keyboard
  design below is now borrowed straight from it.

**The delta, then, is three things:** one merged nested list instead of three parallel flat ones;
detail as a function of distance from the reader rather than a global setting; and a fit guaranteed
by construction, so the thing is a picture of the document rather than another list to scroll.

## The shape

Every node gets a row, always, one line each. Position changes almost nothing about the skeleton —
only how much each row says.

```
  ┌─ where you are ─┬─ OUTLINE (the whole document, always) ────────┬─ the prose ───────────┐
  │                 │                                               │                       │
  │   ▇▇▇▇▇▇▇       │  1   What feeling is for               ✓      │  …the dress was never │
  │   ▇▇▇▇          │  2   The body as a model               ✓      │  about the dress. It  │
  │   ▇▇▇           │                                               │  was about how little │
  │  ┌─────┐        │  3   WHY COLOUR IS A GUESS                    │  of what you see gets │
  │  │▇▇▇▇▇│ ◄─ you │      ───────────────────────────────────      │  in through the eye.  │
  │  └─────┘        │      3.1  Colour as inference          ✓      │                       │
  │   ▇▇            │                                               │  What arrives is a    │
  │   ▇▇▇▇          │      3.2  The dress, again             ◄─ you │  correction to a      │
  │   ▇▇▇           │           Seeing is a controlled guess,       │  guess the brain had  │
  │   ▇▇▇▇▇         │           and the guess is about the body     │  already made…        │
  │   ▇▇            │           that is making it.                  │                       │
  │                 │                                               │                       │
  │                 │      3.3  What the illusion is for            │                       │
  │                 │                                               │                       │
  │                 │  4   The self is a perception too             │                       │
  │                 │  5   Being a beast machine                    │                       │
  │                 │                                               │                       │
  └─────────────────┴───────────────────────────────────────────────┴───────────────────────┘
    proportional:      equal-weight: the shape of the ARGUMENT           what you are reading
    how MUCH is left   (every part present, one line, whatever its size)
```

**The spine stays on, and the two are complements rather than duplicates.** The spine is
*proportional* — a squashed picture of the article, so a two-paragraph part is a sliver — and answers
*how much is left*. This list is *equal-weight* — every part gets a line whatever its length — and
answers *what is the shape of the case being made*. Greg, 2026-08-28, asked for both. (The rail is
being narrowed and its hover cards enriched in parallel: [spine-rail.md](spine-rail.md).)

## How the space gets spent

Work down this ladder until the height runs out. Every rung is all-or-nothing — no half-expanded
anything, because a partly-drawn level is a lie about the structure.

```
  ALWAYS   1. every part, one line each        ── if this will not fit, nothing will
             ↓
  then     2. + the sections of the part you are in, one line each
             ↓
  then     3. + one sentence on the section you are in
             ↓
  then     4. + the arc sentence for the part you are in
             ↓
  then     5. + the paragraphs of that section, one line each   (their navLabels)
                 — ONLY if the section has at most 8 of them,
                 — and never on a narrow window (see The iPad, below)
             ↓
  STOP        leftover space is left BLANK
```

Greg asked me to use my judgment on the ordering (2026-08-28, *"Not sure I understand the question.
Use your judgment for now"*). Four decisions in it:

- **The current section's own sentence (3) comes before anything finer.** *What is this bit about* is
  the question the reader has; *which paragraphs are in it* is a finer question they only have once
  they have the first answer.
- **The arc sentence (4) comes before the paragraph labels (5), and this was the other way round
  until GPT Sol's review of this plan.** Its argument is right and worth keeping: the arc says where
  the whole argument stands, which is the question the whole mode exists to answer, while a
  paragraph label restates prose that is already on screen a few centimetres away. It is also one
  row against up to twenty-six — see below — so putting the expensive rung first meant the cheap
  valuable one never got drawn.
- **The paragraph rung is capped at eight, and the cap is not a hedge.** noema's *1: Brains Are Not
  Computers* has **26** paragraph children where its neighbours have 3 to 5
  ([the corpus](#what-the-real-corpus-says-so-the-fit-is-arithmetic-and-not-a-guess)). Expanding it
  inserts twenty-six rows on crossing one boundary, which is both the worst churn on the corpus and
  a rung that would simply fail to fit and be dropped again on the next section. A section with more
  paragraphs than the cap gets no paragraph rows at all — never a truncated list, which would be a
  lie about the structure.
- **Nothing expands around the neighbours.** An earlier draft spent spare room on the sections of the
  parts either side. Cut: a lot of rows for modest value, and — the real reason — it is the rung that
  makes crossing a part boundary move the whole list. See [What actually moves](#what-actually-moves).
- **Leftover space is left blank, and that is deliberate.** The obvious instinct is to keep
  spending until the panel is full. [column-context.md](../project/column-context.md) records why
  not, from the landmark-lines arithmetic: *blank space is recoverable and visible; entries pushed
  off the foot of a panel that cannot be scrolled are neither.* A ladder that stops early is a ladder
  whose bottom rung never has to be un-drawn. Sol's review asked for one refinement and it is taken:
  before leaving space blank, try the *cheaper independent* rungs that a more expensive one skipped
  — if rung 5 does not fit, that is not a reason to stop looking at anything that costs one row.

**When even rung 1 will not fit** — a piece with sixty parts, or a short window — the last resort is
dropping *words*, never *rows*: the titles clamp to one line and stay. If the parts alone still
overflow, the list falls back to showing the parts' numbers and titles at the smallest tier and
accepts clipping at the foot with a fade, which is the same admission the gist columns already make.
This should be rare and it should be visible when it happens; it is not a silent state.

## What actually moves

This is the risk in the whole design and the reason the ladder is shaped as it is.

```
   reading part 3                          →   crossed into part 4
   ─────────────────────────────                ─────────────────────────────
   1  What feeling is for      ✓                1  What feeling is for      ✓     ← unmoved
   2  The body as a model      ✓                2  The body as a model      ✓     ← unmoved
   3  Why colour is a guess                     3  Why colour is a guess    ✓     ← collapsed
        3.1 Colour as inference  ✓              4  THE SELF IS A PERCEPTION       ← expanded
        3.2 The dress, again   ◄ you                 4.1 The predictive self
            Seeing is a controlled…                  4.2 Volition without magic ◄ you
        3.3 What the illusion is for                     Choosing is a feeling, not…
   4  The self is a perception                      4.3 Who is doing the choosing
   5  Being a beast machine                     5  Being a beast machine           ← unmoved
```

Rows above the boundary do not move. Rows below move only by the difference between the branch that
closed and the branch that opened, which on a tree with a roughly even branching factor is close to
zero. The churn is contained between where the reader was and where they now are — which is where
their eye already is.

**This deliberately reverses a decision taken three days earlier, and the reversal needs stating.**
[column-context.md](../project/column-context.md) says:

> The fisheye stays a matter of size, not of length. Every landmark on a level gets the same number
> of lines; what varies with distance is the type … Giving `near` more lines than `far` would have
> meant several entries rewrapping at every section boundary.

Length varying with distance is exactly what is being asked for here. The claim is that it is right
here and was wrong there, and the reason is blast radius: in three side-by-side columns a length
change reflows three lists at once and the reader is looking at all three; in one merged list it is
one row growing at the point of attention, with a compensating collapse of a branch they have left.
**That is an argument, not evidence.** It gets checked in a browser, and the honest test is whether
it feels like the progress hairline Greg had removed for being distracting
([column-context.md § There is no control](../project/column-context.md#what-a-gist-column-shows-now)).

**And "does it feel like the hairline?" is not an acceptable test on its own** — Sol's finding, and
fair, because it is the only test the first draft named and it is entirely subjective. The claimed
blast radius of "one row growing" also omits three real sources of motion: the outgoing branch and
the incoming branch are *different sizes*; the chosen rung can change between one section and the
next; and reusing the `cur`/`near`/`mid`/`far` type scale changes the size of several rows, not one.
The corpus is not even enough for the hand-waving version of the argument:

```
  constitution   "Following Anthropic's guidelines" →  "Being broadly ethical"
                    3 sections out                       15 sections in     = +12 rows

  noema          neighbouring sections have 3-5 paragraphs, "1: Brains Are
                 Not Computers" has 26                                      = the rung cap

  source         "Author Biography" has 2 children — the degenerate end
```

So the acceptance test is a **measurement**: the displacement of the rows that did *not* change,
across those crossings, in both directions, at band widths 288px and 400px and at viewport heights
390px, 620px and 1024px. Oscillating back and forth across a boundary is part of it. A number, then
a judgment from Greg — not a judgment alone.

Mitigations, in the order they should be tried if it does churn:

1. **Change only on boundary crossings**, never continuously. This falls out of the design — the
   input is *which node contains the reading position*, which is a discrete value.
2. **No transition on the collapse/expand.** `scroll-behavior: smooth` on the context panels
   exists to keep the focus line honest; here there is no scrolling to smooth, and an animated
   height change is a thing moving in the corner of the eye every boundary.
3. **Hysteresis at the boundary** — do not re-expand until the reader is some way into the new
   section — if crossing back and forth at a seam flickers.

## What it is built from

Nothing new is generated. Greg, 2026-08-28: *"let's try and reuse with what we already have"*.

| Rung | Text | Where it comes from | Cost |
|---|---|---|---|
| part / section title | `title` (2–6 words) | `tree.json`, stage 4 | free, always present |
| a sentence | `gist` | `tree.json`, stage 4 | free, always present on internal nodes |
| a paragraph row | `navLabel` | `tree.json`, stage 4 | free, always present on leaves |
| the arc sentence | one sentence per part | `arc.json`, stage 5b | absent until `npm run arc`; rung 5 is simply skipped |

So the mode works on any article that has been through the ToC stage, needs no model call, and is
free for a visitor — the same property `toc` mode has, and the reason `visitorGap` returns `null`
for it ([visitor.ts](../../src/web/visitor.ts)). **`summaries.json` is deliberately not used**: its
`short` and `long` rungs are generated and may be missing, and a mode whose layout depends on text
that might not exist has two shapes and one test.

The **navLabel contract holds** ([granularity-zoom.md § Node shape](../project/granularity-zoom.md#node-shape)):
a navLabel is navigation chrome and may never be shown *instead of* prose that could be displayed.
Here the prose is on screen beside it — a mode band never hides the article — so rung 4 is annotation,
exactly as the `Para` column is.

## The code

**One pure projection, and everything reads it.** GPT Sol's review of this plan was blunt about the
shape, and it is right: the renderer and the current-row walk must not reconstruct the drawn list
separately. So there is exactly one function —

```ts
outlineProjection(geometry, tree, arc, focusRow, rung) →
  { rows: OutlineRow[]; currentId: NodeId | null; rung: Rung }
```

— pure, testable without a DOM, and the single answer to *what is drawn* and *which row is current*.
Every bug this repo has written up in this area is two pieces of code deriving the same rule apart
([summaries.md § Which row is "the relevant one"](../project/summaries.md#which-row-is-the-relevant-one)).

What it reuses, and what it deliberately does not:

- **Not `currentEntryId` / `showsChildren`.** The first draft of this plan said to call them with
  empty `closed` / `opened` sets. Sol showed that cannot express this mode: `showsChildren` has
  `deep` (a whole level), `closed` and `opened`, and none of them means *open only the branch
  containing the reader*. `deep: 1` draws no sections; `deep: 2` draws every part's sections. The
  projection expresses selective expansion directly instead.
- **Not `buildSummaryTree(…, depthLimit: 3)` on its own.** It walks raw `children`, so it carries
  through exactly the nodes [the blank-row finding](#a-leaf-can-sit-at-section-level-and-it-draws-a-blank-row)
  is about. The navigation projection that strips those lives in
  [`navigableItems`](../../src/web/tree.ts) and `itemsFromCells`, and the projection here must do the
  same job: drop continuation cells, drop leaves that are not structural rows, collapse the
  supplement to one entry, read `leafDepth` from the geometry rather than assuming paragraphs are at
  depth 3 (`revistes-ub-30977` has leaves at depth 2), and never substitute `gist` for `navLabel` or
  the reverse. `buildSummaryTree` is still the right source for the nesting, the `"3.2"` numbering
  and the `blocks` count — it is just not the whole of it.
- **`focusRow`, not `atRow`.** This is the second half of Sol's first blocking finding and the
  remedy is cheaper than either option it offered. `?at=` is section-granular by design —
  [`sectionDepth`](../../src/web/position.ts) is `leafDepth - 1` and the id stored is the section's
  *first block* — so a paragraph rung fed from `atRow` would mark the section's first paragraph as
  current, always, on every article, and look entirely plausible doing it. But the exact row under
  the focus line is already measured and already exported:
  [`LiveContext.focusRow`](../../src/web/useColumnContext.ts), which is what the gist columns'
  panels use. That is the input. `atRow` is not used here at all.
- **`Tier`** (`cur` / `near` / `mid` / `far`) and the `before` (already read) flag are the existing
  vocabulary for distance and progress and the CSS exists. Computed over the *drawn rows*, so
  `levelList` itself is not reused — only the type and the styling.
- The hover card should be the spine's `BandCard` or whatever [spine-rail.md](spine-rail.md) leaves
  in its place, not a second implementation. Note that `BandCard` is currently private to `Spine.tsx`
  and typed against `OutlineEntry`; extracting it is that plan's call, not this one's. Coordinate
  before writing one.

New: `src/web/OutlinePanel.tsx`, `outlineProjection` in a new `src/web/outline.ts`, a
`§ outline mode` section in `styles.css`, and `"outline"` in `MODES` and `MODES_UI`.

### A visitor gets nothing unless we say so

The first draft of this plan claimed the mode is free for a visitor "the same property `toc` mode
has". That is the *intent* and it is **false in the code today**:
[`visitorGap`](../../src/web/visitor.ts) returns `null` for `toc` alone and every other mode falls
through to `{ kind: "owners-only" }` — deliberately, so that a mode added later fails closed rather
than rendering an empty band. Found by Sol's review; verified.

So `outline` must be added to that early return **explicitly**, with a test that a visitor with no
artefacts at all still gets the mode. The tree is in the payload they already hold, so it genuinely
costs nothing — but nothing infers that.

### What the real corpus says, so the fit is arithmetic and not a guess

Measured across every `tree.json` in `data/` on 2026-08-28:

| article | parts | sections | sections in the biggest part | leaves | leaves per section |
|---|---|---|---|---|---|
| noema-mythology-of-conscious-ai | 5 | 21 | 6 | 141 | ~7 |
| constitution | 7 | 50 | **15** | 360 | ~7 |
| fowler-phrenology | 9 | 40 | 6 | 72 | ~2 |
| writes | 4 | 12 | 5 | 19 | ~2 |
| revistes-ub-30977 | 5 | 12 | 3 | 41 | ~3 |

So the whole ladder, at its worst on this corpus, is **7 parts + 15 sections + a three-line gist +
7 paragraph rows ≈ 32 rows**, and every other article is well under 20. At the band's line height
that is roughly 700px — it fits a laptop window and it does not fit a short one. Rung 1 alone is
never more than nine rows, so the "even the parts will not fit" fallback is a guard against articles
we do not have rather than a case anyone will hit soon.

**The constitution's fifteen-section part is the stress case**, and it is the one to build against:
it is where crossing into that part expands the list by fifteen rows at once, which is the churn
argument's worst moment.

### A leaf can sit at section level, and it draws a blank row

Found in the corpus rather than in the docs, and it is exactly the class this repo keeps writing
memos about — **nothing errors, nothing looks wrong, a row is simply empty**.

`revistes-ub-30977` has two nodes at **depth 2** with no children. They are sections by depth and
leaves by shape, so:

```
  n0059   depth 2   children 0   title ""   gist absent   navLabel "Lyn McCredden teaches…"
  n0058   depth 2   children 0   title ""   gist absent   navLabel absent
```

`n0059` renders as a blank row unless the list falls back to its `navLabel`; `n0058` renders as a
blank row **whatever** the list does, because it has no text of any kind.

Two consequences for this plan:

- **A row must never assume `title` is present**, and the existing gist columns dodge this rather
  than solve it — `itemsFromCells` ([context.ts](../../src/web/context.ts)) keeps continuations and
  leaves out of the level lists entirely, so the case cannot arise there. A nested list that walks
  the tree by depth meets it directly.
- **The navLabel contract decides the fallback, and it decides it in our favour, but only just.**
  Falling back to `navLabel` for a leaf-shaped section is allowed *here* — the prose is on screen
  beside it and this is navigation chrome — but it is precisely the fallback
  [granularity-zoom.md § Node shape](../project/granularity-zoom.md#node-shape) forbids in the
  reading column. Writing it once, in `tree.ts`, with the reason on it, is the difference between a
  considered exception and the bug that doc warns about.
- **A node with no text at all gets no row.** Not a blank one. And the count of dropped rows is
  worth surfacing in dev, because "a node the outline cannot render" is a pipeline defect the outline
  happens to be able to see.

**And there is a second node with no gist, by design.** The supplement node — the apparatus, added
2026-08-28 ([granularity-zoom.md § The supplement node](../project/granularity-zoom.md#the-supplement-node))
— carries an authored title and deliberately no gist, because the footnotes are not part of the
argument. Greg asked for it to be reachable from the structure so he can jump to the footnotes, so
**the outline shows it**: one row, its title ("Notes"), never expanded, never given a sentence, and
dimmed the way the spine dims its band. `ContextItem.supplement` already carries the flag.

This also needs a test with a fixture that actually contains such a node — per
[a-corpus-that-cannot-exercise-its-arm](../reusable/silent-success.md), a test whose fixture has a
title on every node is not testing this.

### The fit is measured, not estimated — and that reverses the precedent

The first draft of this plan estimated line counts from character counts, following
[column-context.md § How much a landmark says](../project/column-context.md#how-much-a-landmark-says).
GPT Sol's review rejected that, and on checking it, **the cost-benefit that justified estimating
there genuinely inverts here**:

|  | the gist columns | this panel |
|---|---|---|
| hidden renders to choose | five candidates × **three** panels | five candidates × **one** panel |
| cost of estimating wrong | a slightly blank column | **rows pushed off a panel that cannot scroll** |
| what the check proves | the estimate matched itself | — |

That last row is the decisive one and it is the [silent-success](../reusable/silent-success.md)
pattern exactly: `data-outline-rung` and a pure height sweep can only ever prove *what the estimator
chose*. Neither can prove the rendered list actually fits. So:

- **Render all five candidate lists off-screen at the real band width, read their heights once, take
  the largest that fits.** There is no measure-resize-measure loop, because the hidden candidates
  have fixed geometry and only the chosen visible one changes.
- **Re-measure on the band's own `ResizeObserver` and on `document.fonts.ready`** — a font swap
  changes every row's height with nothing else moving, which is the second of the two observers
  `column-context.md` needed and for the same reason.
- **Read the band's real `clientHeight`**, not `window.innerHeight` and not the panel's own measured
  top. Both of those mistakes are written up in
  [column-context.md](../project/column-context.md#how-much-a-landmark-says), and the second is the
  one that actually bit — it looked exactly like the fix for the first. `100svh` remains the right
  fallback if the observer has not fired.
- **`data-outline-rung` stays**, not as the check but as the thing that makes a browser session able
  to say which rung was chosen. It is evidence about the decision, never about the fit.
- **The fit must be monotonic in window height.** A taller window may never show *less* — the same
  class as the non-monotonic column fit found by sweeping widths, and it gets the same defence: a
  sweep, in `tests/outline.test.ts`.

**The tests assert the DOM, not the arithmetic** — Sol's closing demand, and it is right. In a
mounted component test: every part id appears exactly once; the expected current id is the one
drawn; `scrollHeight <= clientHeight`; and the last row's rectangle is inside the panel. And per
[the house rule on checks](../reusable/silent-success.md), **mutate row padding or line-height and
watch the overflow assertion go red** before believing it — a fit test that cannot fail is testing
something else.

## Interaction

- **Clicking any row jumps the article there**, exactly as a gist cell and a summary row do
  (`onJump`). The list then re-fisheyes around the new position, which is coherent: you asked to be
  there.
- **The wheel over the panel scrolls the article.** The panel is `overflow: hidden` and nothing but
  its own file touches its `scrollTop` — the `ContextPanel` rule, and the reason "focus follows
  scroll" survives.
- **Hover gives the full card** for any row whose text is clamped, grouped so running down the list
  reads the article's sections one after another.

  **One shared "which card is open" state across many triggers is a bug, and it has already been
  paid for once here.** The spine's cards stopped working on 2026-08-27 for exactly this reason:
  every band's `Tooltip` was made *controlled* off one piece of state so a finger could pin a card
  open, and Floating UI then killed it from two directions — `useDelayGroup` calls **every other**
  member's `onOpenChange(false)` in a layout effect the moment one opens, and `useHover` schedules a
  close 90ms behind the pointer with no check that this trigger is still the open one. Both are
  correct against an *uncontrolled* tooltip, where each clears only its own state; against one shared
  value they clear somebody else's. The symptom is a card that mounts and vanishes 80ms later, which
  reads as "there are no tooltips". Root-caused by the `spine-rail` agent, 2026-08-28; see
  [spine-rail.md](spine-rail.md) and `tests/spine-hover.test.tsx`.

  So this panel's rows either keep their tooltips **uncontrolled**, or guard the close by id —
  `v ? {id} : prev?.id === id ? null : prev`. A list of forty rows in one `TooltipGroup` is the same
  shape as fifty bands in one, and it would fail the same way.
- **Reading progress shows.** Rows the reader has passed carry the existing `before` treatment. This
  is half of "where am I in the grand scheme of things" and it is free.

### The keyboard, and a pattern that already exists here

The first draft said: clickable `<li>`s, not in the tab order, the same trade the context lists and
the table cells make. Sol's review pushed back and it is right — those lists are *annotations beside*
a level, while this is the mode's entire content, and making the whole of a mode unreachable by
keyboard or screen reader is a different thing from keeping a hundred tab stops out of the prose.

**Diagram mode already solved exactly this**, and the solution is written up in
[diagram.md § Interaction](../project/diagram.md#interaction): the picture is **one** tab stop, not
one per node; ↑ / ↓ step the drawn order and take the article with them; Home / End reach the ends;
← closes an open node or goes to its parent, → opens a closed one or steps into its first child;
Enter jumps. That is the [W3C tree-view pattern](https://www.w3.org/WAI/ARIA/apg/patterns/treeview/),
and each node carries `aria-level`, `aria-setsize` and `aria-posinset`. Copy it. This list is a real
`<ul>` so it gets some of that from the markup, and it adds `aria-current="location"` on the row the
reader is in.

One tab stop keeps the original objection satisfied — the prose is still one Tab away — while making
every row reachable.

### The iPad, where this plan was wrong

**Below 856px there is no prose beside the band: the band covers the article.** Confirmed in
[`layout.ts`](../../src/web/layout.ts) — under `MODE_MIN + PROSE_MIN` the negotiation bottoms out,
`modeW` goes to 0, and `styles.css § a narrow window` widens the fixed band to the whole window.
iPad portrait is 768–834px CSS pixels, so this is not an edge case on the device this app is most
for ([touch.md](../project/touch.md)).

Two things follow, and the first is a correction to this plan rather than a detail:

- **The navLabel justification collapses there, so rung 5 is dropped on a narrow window.** The whole
  argument for showing paragraph labels was that the prose is on screen beside them, which makes them
  annotation rather than substitution
  ([granularity-zoom.md § Node shape](../project/granularity-zoom.md#node-shape)). With the article
  hidden behind a full-screen band that is simply false, and drawing them anyway would be the exact
  failure principle 1 guards against. So on a narrow window the ladder stops at rung 4.
- **On a narrow window the mode is a navigator, not a companion.** Tapping a row jumps the article
  *and closes the band*, because leaving a full-screen panel over the paragraph the reader just
  asked for is not a behaviour. Hover cards are unavailable — `touch.md` already treats hover-only
  information as not existing — so anything a card would have said has to be in the row or reachable
  by tapping it. Rows need 44px targets.

This needs a real interaction design on the device, not a browser check at a narrow width. It is the
part of this plan I am least confident in.

## Where it sits, and what happens if it wins

Greg, 2026-08-28: *"Let's do this as an 8th mode for now, so that it doesn't mess with what we have,
and so that I can go back and forth to compare."* So it is additive; nothing existing changes.

Stated plainly, because it is the cost: an eighth pill in a bar Greg has just described as busy. If
this mode wins the comparison, the follow-up is not "keep both" — it is either replacing the gist
columns' context panels in `toc` mode with this list, or folding it into summary mode as a fourth
rung on the `LENGTH` control. That decision comes after using it, not now.

## A name collision to settle

The pill is **Outline**, Greg's choice, 2026-08-28. But `?text=0` — the contents table with the prose
hidden — is called "outline mode" throughout
[granularity-zoom.md](../project/granularity-zoom.md#two-modes-reading-and-outline), and
`buildOutline` / `OutlineEntry` in [`tree.ts`](../../src/web/tree.ts) are the *spine's* data
structure, not either of those things.

**Not now, though.** Sol's review asked that the rename not be bundled into this experiment, and
that is right: it adds risk and churn to files this mode does not otherwise touch, before the mode
has earned its place. So the pill says **Outline** and `?mode=outline` ships; the sweep below waits
until the comparison Greg wants has actually happened. Until then two things share a word, which is
a cost worth naming and paying.

Proposed, when the time comes: this mode takes the name `outline` (pill, `?mode=outline`, docs), and the `?text=0` state
is demoted to being described as what it is — *the table with the prose hidden*, a state of contents
mode rather than a mode with a proper noun. That is a rename sweep across several docs and it follows
[rename-or-move.md](../reusable/rename-or-move.md): grep for fragments as well as the whole word,
since `buildOutline` and "outline mode" do not match the same pattern, and decide each hit rather
than replacing in bulk. `buildOutline` itself is better named `buildSpineOutline`.

**The sweep's size, measured 2026-08-28:** "outline mode" appears 27 times across 11 files, of which
five are live docs — `granularity-zoom.md`, `column-context.md`, `url-state.md`, `web-client.md`,
`browser-testing.md` — and the rest are plans and research, which
[CLAUDE.md](../../CLAUDE.md) keeps as a record of what was thought at the time and which should
therefore be left alone. `buildOutline` / `OutlineEntry` appear 18 times in `src/` and `tests/`. So
the live sweep is five docs and one rename, which is small enough to do in the same piece of work.

## What would make this fail

- **It is a fourth thing that does what three things already do.** The comparison Greg wants is the
  test, and the failure is a tie: if it is merely *as good as* the columns, it should not ship, and
  the honest outcome is deleting it.
- **The churn.** See [What actually moves](#what-actually-moves). If the list breathes distractingly
  at every boundary, the feature is the hairline again.
- **The fit undershoots badly on real articles** and the panel is half empty on every window, which
  is the exact complaint that produced `landmarkLines` one level up.
- **The whole structure does not actually fit.** A piece with forty parts gets rung 1 and nothing
  else, and the mode degenerates into a worse version of the parts column. Test on a long article
  with a deep tree, not only on the Noema one.

## The plan-stage review

GPT Sol, gpt-5.6-sol, 2026-08-28 — `outline-mode-review-sol.md`, from
`outline-mode-review-prompt.md`. Verdict: **revise before building**, with three blocking findings.
Every factual claim in it was checked against the code and the data before anything here changed,
and all six of the substantive ones held:

| Finding | Checked | Outcome |
|---|---|---|
| `currentEntryId` / `showsChildren` cannot express selective expansion | yes | accepted — one pure `outlineProjection` instead |
| `?at=` is section-granular, so a paragraph can never be current | yes — [`sectionDepth`](../../src/web/position.ts) is `leafDepth - 1` | accepted, **with a cheaper remedy than either it offered**: `LiveContext.focusRow` already measures the exact row |
| `buildSummaryTree` walks raw children and draws blank rows | yes — and found independently, [above](#a-leaf-can-sit-at-section-level-and-it-draws-a-blank-row) | accepted |
| character-count fitting cannot prove the list fits | yes | accepted — measure five candidates once |
| the band covers the prose below 856px, so the iPad design is undefined | yes — `MODE_MIN + PROSE_MIN`, and iPad portrait is 768–834px | accepted; rung 5 dropped on a narrow window |
| unfocusable rows repeat a problem Diagram mode has solved | yes — [diagram.md](../project/diagram.md#interaction) | accepted — copy the tree-view pattern |
| noema has a 26-paragraph section; the corpus is not even | yes | accepted — the rung cap, and the churn measurement |
| the ladder spends the arc after the paragraph labels | judgment | accepted — arc moved up |
| visitors get nothing unless `outline` is named | yes — [`visitorGap`](../../src/web/visitor.ts) fails closed | accepted |
| don't bundle the rename into the experiment | judgment | accepted — deferred |

One inaccuracy, noted for completeness and consequential to nothing: it says `source`'s
"References and Author Bio" has one child; it has two.

**One suggestion recorded rather than taken.** Sol proposed a fifth option nobody had named: instead
of an eighth mode, a *variant of Diagram mode's tree* — a stable compact tree above, a fixed-height
detail card for the current section below, and no branch-driven reflow at all. It is a real answer to
the churn risk, because it removes the churn by construction rather than arguing it is small. It is
not taken because Greg explicitly chose an eighth mode so he can go back and forth and compare
(2026-08-28), and Sol agrees that is reasonable — but if the churn measurement comes out badly, this
is the design to fall back to rather than tuning hysteresis.

## See also

- [column-context.md](../project/column-context.md) — the centred fisheye per column, the research
  behind it, and the size-not-length decision this plan reverses
- [summaries.md](../project/summaries.md) — the panel this borrows its walk, its marks and its
  follow-the-reader lessons from
- [granularity-zoom.md](../project/granularity-zoom.md#the-other-view-fisheye) — the fisheye sketch
  from 2026-08-24 this is the first real descendant of
- [spine-rail.md](spine-rail.md) — the rail, narrowed and given richer hover cards, in parallel
- [silent-success.md](../reusable/silent-success.md) — most of the traps named above are instances
