# Skim's Figures walk, and a mark on each Structure row that holds one

Report `spya-sb0c7e` (SPIDERYARN-READING2-GS, #544), queue item `qi-wh7c3862`. Greg, 2026-10-10, from
Summary mode on *Lawrence Kuhn 2024, A landscape of consciousness*:

> I would quite like to be able to jump to all the tables and figures and media easily. I can't
> decide whether it makes more sense to put that in structure or in skim. Maybe in skim. And perhaps
> we can have an icon for each diagram or table contained in a section within structure so that you
> could easily see which parts of the piece do have diagrams or tables and then use structure to
> jump to them. Use your judgment about how to add it to skim. Maybe it's a separate fourth submode.
>
> — Greg, 2026-10-10 (`spya-sb0c7e`)

Two halves, both read off the article's own blocks. No model call, no pipeline change, no new
stored artefact.

## What counts as a figure

One pure function, `src/figures.ts` § `figureOf(block)`, shared by both halves, answering
`"figure" | "table" | "media" | null`:

- **`table`** — `tag === "table"` (stored tags are lower case) (stage 3 classifies these `kind: "other"`, `src/blocks.ts`
  § `classify`), or a `FIGURE` whose markup holds a `<table>` (a PDF's table, or an author's
  `<figure><table>`).
- **`media`** — a `kind: "media"` block holding `<video>`, `<audio>` or `<iframe>` (the sanitizer
  keeps only allowlisted video embeds).
- **`figure`** — any other `kind: "media"` block holding `<img>`, `<svg>`, `<picture>` or
  `<canvas>`: a `FIGURE`, a bare `IMG`, an image-only paragraph.
- **Not a figure**: `HR` (also `kind: "media"`), and a `<figure>` with no picture in it, which is a
  pull-quote. Code (`PRE`) and display maths are not in the ask; leaving them out is the simpler
  first version, and either is one more arm later.

Each figure gets a **label**: its own caption when it carries one (`<figcaption>`'s text), else a
`kind: "caption"` block directly before or after it (stage 3's `CAPTION_MARKER`: *"Figure 2: …"*,
*"Table 1."*), else nothing, in which case the row says *"Table"*, *"Figure"* or *"Media"* with
its number among its own kind. The label is the author's words, so it is drawn in the author's
face ([fonts.md](../project/fonts.md)).

`figuresOf(blocks)` returns them in reading order. It is a pure function of `blocks`; nothing to
cache, nothing to invalidate.

**Changed after GPT Sol's plan review**
([261011b-skim-figures-plan-review-sol.md](261011b-skim-figures-plan-review-sol.md)):

- A LaTeXML displayed equation is a `<table class="ltx_equation ltx_eqn_table">`, and a page laid out
  in a table says `role="presentation"`; neither is a table (F2). Without this a paper's Figures
  walk would be mostly equations.
- A `<figure>` holding a `<blockquote>` is a pull-quote even with a portrait in it (F2).
- A standalone `<svg>`, `<canvas>`, `<video>` or `<audio>` is not a leaf in stage 3, so one with
  text of its own arrives as a block of another kind; it is classified by tag, whatever its kind (F1).
- **An image whose declared height is under 48 px is lettering**, not a figure: Paul Graham's essays
  set their title as a 190 × 18 GIF. An image with no declared height is kept. A genuine figure
  under 48 px tall is the price, and is rare.

## Half 1: Skim gets a fourth chip, *Figures*

The head's part-switcher reads **Gist · More · Most · Figures**. Figures is a walk through every
figure, table and medium in reading order, with the same stepper, the same rows, the same door in
the prose and the same ← / → keys as the route. It is offered whenever the article has at least one
figure, and it needs no route: an article whose route is still being planned, or failed, can still
walk its figures.

```
┌ Skim ──────────────────────────────────────────────┐
│ ‹  ·─•──·───·  ›          Gist 4 · More 12 · Most 20 · Figures 7 │
│ 1  ▣  Figure 1. The landscape, by category   ·    │
│      2 Materialism theories                        │
│ 2  ⊞  Table 1. Theories and their claims     ·    │
│ ...                                                │
└────────────────────────────────────────────────────┘
prose: … [the figure, flashed] …
         ‹ Previous figure                 Next figure ›
                                    Table 1. Theories and their claims
```

- **Address.** `?depth=figures`, the same parameter as the passes, so a chip is one value and the
  back button walks between them as it does between passes. `?stop=` is the figure's block id. A
  `?stop=` naming no figure falls back to the first.
- **Rows.** Number, the position dot (`positionsOf`, as the route's), the section path
  (`sectionNodesOf`, as the route's), a kind icon (Lucide `Image`, `Table2`, `Film`), the label.
  No cue, no pips, no stop card: those are the route's.
- **Door.** *Next figure ›* with the next one's label under it; *‹ Previous figure* from figure 2
  on; at the last, *"End of the figures — 7."* and nothing deeper. `DoorView` grows a noun so the
  door and its tooltip say *figure* rather than *stop*.
- **Arriving.** Scrolled to the centre and flashed with `flashBlock(block)` — the whole block, there
  is no quote to narrow to — through the same `arrive` rule, and a row press is a jump through
  `onJump`, exactly as the route's.
- **Visitors.** A visitor's Skim band exists only when a route was stored
  (`VisitorSkimBand`); it gets the chip too. A public article with no stored route has no Skim band
  for a visitor today, and this change does not add one — that is a separate question about
  visitors and empty modes.
- **Opening Skim still plans the route** when there is none (mode.md: *opening a mode starts it*).
  Choosing Figures does not cancel it.

### How it is built

The route's controller (`useSkimMode`) is keyed on quotes throughout. Rather than teach it a second
kind of stop, the band chooses between **two walks**, each its own component with its own hook, and
both publish the same `SkimControl` upward, so `Reader`'s keys and door need no change beyond the
noun:

- `SkimBand` and `VisitorSkimBand` read `?depth=`; on `figures` they draw `FiguresWalk`, otherwise
  the route walk they draw today (its hook moved into a child component so the choice is not a
  conditional hook).
- `FiguresWalk` (`src/web/modes/skim/FiguresWalk.tsx`) with `useFiguresWalk`: `figuresOf(blocks)`,
  locate the current one from `?stop=`, step, door, arrival token, publish `SkimControl`. The
  arrival token (`SkimArrival`) is claimed the same way, factored into one shared hook so the two
  walks cannot disagree about a deep link.
- The part-switcher becomes one small component, `SkimParts`, drawn by both walks: the route's
  depths (when there is a route) and *Figures* (when there are figures). Switching between a pass
  and Figures is a pushed `?depth=`/`?stop=` pair landing on the first stop of the target, the same
  as switching passes today. The newly mounted walk is handed that stop through the arrival token,
  so it scrolls there and flashes, without a second history entry.
- **The panel needs a readiness of its own for Figures** (Sol F3): today `SkimPanel` shows its head
  and rows only over a ready route. `FiguresWalk` draws its own body through `ModeSurface`, and
  `useSkim` stays mounted above the choice, so the route goes on being planned underneath.
- **Part switches arm the arrival** (Sol F4): the switch puts the target stop into `SkimArrival`
  synchronously before the one URL write, and the mounted walk claims it. Figures arrives with a
  whole-block helper (`scrollToBlock` + `flashBlock(block)`, no passage), and publishes no passage,
  so the route walk's layout cleanup leaves no quote ring behind (F5). Back and Forward arm nothing,
  as today.
- `?depth=` is parsed into a client-only `SkimPart = SkimDepth | "figures"`; the stored
  `SkimDepth` is unchanged (F4). `last-view.ts`, which remembers `depth` and `stop`, gets its
  comment corrected.
- The door's noun covers every literal in it: *Previous*, *Next*, the tooltips and the end line (F5).
- Outline's drawn and measured rows share `RowBody`, not `Row`: the mark goes there (F6).
- With no route yet, the route's empty/loading/failed surface shows its *Figures* chip. In the
  Figures walk, a count-less *Route* chip returns to that surface; neither view is a cul-de-sac
  while the route is planned.

## Half 2: a mark on each Structure row that holds a figure

Each row in both faces (`StructurePanel`'s columns, `OutlinePanel`'s list and Expanded) gets, after
its title, a small muted icon for each kind its range holds, with a count when it is more than one:
`▣ 2  ⊞ 1`. Its accessible name is *"2 figures, 1 table"*. A part holding a section that holds a
figure is marked too: the mark is about the range, which is how a reader finds the part to open.

- Counted by row index (`SummaryNode.startRow`/`endRow`, `StructureRow` likewise) by scanning
  `figuresOf(blocks)` — never by comparing ids ([block-ids.md](../project/block-ids.md)). Articles
  have tens of figures, so a prefix-sum structure would add machinery without a useful saving.
- The row is already a jump to its section; the mark adds no second button inside it. To reach the
  figure itself from there, Skim's Figures walk is one chip away.
- **The measured copies.** `StructurePanel` renders hidden copies of its rows to measure them
  (`tip=false`), and the drawn and measured markup must be identical or rows are silently clipped.
  The mark goes in through the one `Row` both use.

## Not in this change

- **Thumbnails in the Figures rows.** The images reach the prose through `rehost.ts` as `blob:`
  URLs; drawing them in the band means a second consumer of that machinery. The label and kind icon
  come first; a thumbnail is a later step once the walk is in use.
- **Code blocks and display maths** as figures (above).
- A Figures walk for a visitor on an article with no stored route (above).

## The simpler option passed over

**A Structure-only version**: just the row marks, and no Skim chip. Half the code, and the marks
alone already say where the figures are. Passed over because Greg's first ask is *"jump to all the
tables and figures and media easily"*, and from Structure a reader still has to scroll the section
to find the figure, one section at a time; the walk is the thing that jumps.

**A Figures mode of its own** was the other shape: cleaner code, no change to Skim's controller.
Passed over because Greg asked for it in Skim, likely as a fourth sub-mode, and because a mode is
fifteen tables to fill (mode.md) for what is a different set of stops on the same walk.

## Stages

1. `src/figures.ts` with its tests (the classification and labels, against fixture blocks and
   hand-built ones: HR excluded, pull-quote figure excluded, figure-wrapped table is a table,
   caption before and after).
2. Structure marks, both faces, with a test that the drawn and measured rows carry the same mark.
3. Skim: `?depth=figures`, `SkimParts`, `FiguresWalk`, the door's noun, the shared arrival hook.
   Tests in `skim-panel.test.tsx` / a new `skim-figures.test.tsx`: the chip appears only with
   figures, a step moves `?stop=`, the door says *figure*, switching from Figures to Gist and back.
4. Docs: skim.md § What shipped, structure.md, url-state.md (`?depth=figures`), keyboard.md if it
   names *stop*; a browser check on an article with figures; GPT Sol code review.
