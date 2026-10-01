# Structure: a Fisheye / Expanded toggle, arrows that step blocks and sections, and one sentence fewer

Up: [structure.md](../project/structure.md) · reports spya-gxyhcc (SPIDERYARN-READING2-90),
spya-b2wzjf (SPIDERYARN-READING2-8R), spya-ukr9dp — all three Greg's, checked with
`scripts/feedback-reporter.ts` (exit 0 on each).

## What Greg asked

> Add a toggle to Structure mode to switch between the Fisheye submode (which should be the default,
> and which is what we're using now), and Expanded mode (which would show everything fully, all of
> the summaries and everything expanded and visible).
>
> I guess there's a question about whether Expanded mode scrolls along with the text or not.
> Ideally it would. I suppose that could interfere with the fact that ideally the user would be able
> to scroll independently within the column... Use your judgment. Let's try and avoid too much
> complexity for the v1.
>
> — Greg, 2026-10-01, spya-gxyhcc

> It looks like we have a keyboard shortcut set for the structure mode, so the up/down jumps
> sections in the structure. … Instead, what I'd suggest is up and down should always do the same
> thing, i.e. jump to the next block in the text, as they do if the focus is on the text.
>
> Perhaps there's something to be said for using left and right in structure mode. … I'm going to
> suggest that left and right should basically jump between the smallest sections. So left and right
> would jump to the previous or next low-level-heading/section.
>
> — Greg, 2026-10-01, spya-b2wzjf

> In the information tooltip for Structure mode, get rid of the sentence that says something like,
> "Uses the same parts and sections as Summary, so there's nothing to generate."
>
> — Greg, 2026-10-01, spya-ukr9dp

## What happens today

- **↑ / ↓** (src/web/keynav.ts § `useArrowNav`): the *pointer* picks the stride — over the spine,
  parts; over the prose, one block; **anywhere else, a section** (`fallbackDepth`, passed as
  `sectionDepth(geometry)` by Reader.tsx). So with the pointer over Structure's band, ↓ jumps a
  section. And when a row of the list face has keyboard focus, `OutlinePanel`'s own `onKeyDown`
  takes ↑ / ↓ (steps its rows and jumps to each) and `preventDefault`s, so the window handler
  stands down. Either way, "focus on Structure" ≠ "focus on the text". That is what Greg saw.
- **← / →** are the browser's except in Trajectory and Quiz, which claim them through
  `useArrowNav`'s `horizontal` argument.
- **The card** — `MODE_CATALOG.structure.how` (src/mode-catalog.ts) starts "The same already-built
  tree as Summary, so there is nothing to generate." That is the sentence.
- **The faces**: Structure is a fisheye already, in both faces. The columns show every part and the
  sections of the current one; the list (OutlinePanel, built by `outlineProjection` in outline.ts)
  shows every part, opens the current one, and climbs a ladder of rungs (gist of the current
  section, arc of the current part, its paragraphs) as far as fits a band that never scrolls.

## The decisions

### 1. Fisheye / Expanded is a sub-mode, `?structure=`

`?structure=expanded`; Fisheye is the default and is omitted from the URL. The same shape as
`?remember=` / `?referee=` / `?summary=` (params.ts): it replaces what the whole band draws, so it
belongs in the URL and is pushed (Back undoes it). It goes in the sub-mode registry
(src/web/sub-modes.ts), so the command bar lists "Structure · Expanded" for free;
`subModeTarget` returns `null` for both (nothing to generate, nothing armed), and `bandTarget`
needs nothing.

**Fisheye is exactly today's mode, both faces, unchanged.**

### 2. Expanded is one scrolling list, whatever the band's width

Not a third face per width, and not an "expanded columns": one nested list in every band width.
Rows: **every part and every section under it, each with its gist** (and the part's arc sentence
where stage 5b wrote one — the list face already draws it for the current part), the apparatus as
one unnumbered row, exactly as the list face draws it. **No paragraph rows** — they are navLabels
standing in for prose that is beside them, and twenty-six of them under one section is the churn
outline.ts § `PARAGRAPH_CAP` exists to avoid; "the summaries" Greg names are the gists. The same
"here" / "now" / "before" marks as the fisheye list.

Built by **`outlineProjection` with an `expanded` flag** rather than a second walk, because that
file's whole design constraint is that one function decides both what is drawn and which row is
current. Expanded ignores `rung` (it draws everything) and draws a section's gist on every
section, and the arc on every part.

**The panel scrolls** (overflow-y: auto) — the one place this band does, so it is a new component
(`StructureExpanded`) rather than a branch inside OutlinePanel, whose fit-measuring exists because
it never scrolls. It reuses `.outln-*` row styles.

**Follow-along, the v1 that cannot fight the reader:** when the row marked `now` *changes* (the
reader crossed into another section), scroll it into view in the panel (`block: "nearest"`, so a
row already visible does not move). Nothing else scrolls the panel. A reader who scrolls the
column by hand keeps their place until they cross the next section boundary in the text — then it
follows again. No pause timer, no "detached" state: that is the complexity Greg asked us to leave
out, and we add it only if the snap-back proves annoying. On mount it scrolls the current row into
view once.

Simpler option passed over: Expanded = the list face pinned at its top rung for every part. It
would still not scroll, so on any real article most of "everything" would fall off the bottom.

### 3. ↑ / ↓: one block, everywhere except the spine

The fallback stride (`useArrowNav`'s `fallbackDepth`) becomes the leaf depth — one block — instead
of a section. So with the pointer over Structure's band, the masthead, any mode band or anywhere
else, ↓ is the next block, exactly as over the prose. **`OutlinePanel` stops handling ↑ / ↓**
(Home / End / Enter / Space stay), so a focused row no longer steps the list; the window handler
takes the key and steps the article, and the list follows because its "now" is derived from the
reading position.

**The spine keeps its "parts" stride** — a deliberate aim (data-nav-depth=1) that Greg asked for in
August, and which this report does not mention. That is the one reading of "always" I did not
take; it is one line to change if he meant it too. Named in the note for him.

### 4. ← / → in Structure: previous / next lowest-level section

While Structure is the mode, ← / → step the section unit — `sectionDepth(geometry)`, the same
unit `?at=` stores and that ↓ stepped over the band until today: the deepest headings above the
paragraphs. Through the existing `horizontal` seam, so every guard applies (no modifiers, not
typing, not a dialog, not auto-repeat, not already handled). The step uses `useArrowNav`'s own
`stepTarget` and its chain, so rapid presses chain and ← on the middle of a section goes to its
start, as ↑ always has. Implemented as a second optional argument to `useArrowNav` —
`acrossDepth`: when set and no `horizontal` handler is, ← / → take that depth's step; Reader
passes `sectionDepth(geometry)` while the mode is Structure. At the ends the key goes back to the
browser.

Simpler option passed over: a horizontal handler built in Reader. It would need its own copy of
"which row am I on" and its own chain, which is the second-copy-of-a-rule shape keynav.ts exists to
avoid.

### 5. The card

`how` loses its first sentence. It gains one naming the keys (tooltips.md § A shortcut is named on
its card) and the toggle: roughly *"Fisheye opens the part you are reading; Expanded shows every
part and section with its summary. ← and → step section by section."* The toggle chips get the
sub-mode registry's descriptions as their cards.

## Stages

1. **Card + keys** — the `how` text; `fallbackDepth` → leaf depth; OutlinePanel drops ↑ / ↓;
   `acrossDepth` in keynav; Reader passes it in Structure. Tests: keynav (← / → step sections in
   Structure, inert elsewhere; ↓ over a band steps one block), OutlinePanel (↑ / ↓ not handled).
2. **Expanded** — `structureParam`; registry entry; `outlineProjection({expanded})`;
   `StructureExpanded`; the toggle chip in both faces and in Expanded; follow-along. Tests: the
   projection (every part and section, gists, marks, no paragraphs), the param degrades, the toggle
   writes the URL, follow-along scrolls only on a change of `now`.
3. **Docs** — structure.md, keyboard.md (the stride table and a "← / → in Structure" section),
   url-state.md, mode.md's checklist as it applies; GPT Sol code review; push; feedback note.

## Out of scope

The Hierarchy→Structure rename (spya-wdfb4h) — its own session. Summary's Parts & Sections
(spya-b3ggv4, fb7q) — another session.

## GPT Sol's plan review, and what changed

Run 2026-10-01 (`--sandbox review`, exit 0, a fresh answer). Nine findings.

1. **"Leaf depth is not one block"** — `navPlan` collapses the apparatus into one item, so ↓ skips
   all the endnotes in one press. **Not taken:** that is exactly what ↓ does over the prose, and
   "as they do if the focus is on the text" is the behaviour Greg named.
2. **The chain outlives a change of `acrossDepth`.** Taken: the effect's cleanup drops the chain.
3. **← in the middle of a section goes to that section's start, not the previous one.** **Kept, on
   purpose:** it is ↑'s rule and Trajectory's ("← on the first stop goes to the first stop again",
   Greg 2026-09-29) — the heading you are under is the previous heading in reading order. Named in
   the note for Greg; strict previous is a one-line change.
4. **The command bar's batched navigation and `ModeBoundary` enumerate sub-mode keys.** Taken:
   `structure` goes into both, the boundary's reset key, `bandTarget`'s shape, and the registry
   tests.
5. **A toggle row above the fisheye list breaks its fit**, which grants the list the panel's whole
   inner height. Taken: the room is measured from the visible list's own top to the panel's
   content bottom, so anything above it is subtracted whatever it is.
6. **Expanded must walk deeper trees**, not stop at part → section. Taken: Expanded walks every
   non-leaf node at any depth (paragraph leaves and the apparatus's insides excluded); a node with
   no text gets no row, as now, but its children are still walked.
7. **Follow-along: `scrollIntoView` scrolls ancestors too, and a phone's stepped-aside band is
   `display: none`.** Taken: the panel's own `scrollTop` is set, and the panel's ResizeObserver
   re-syncs when it comes back from zero height.
8. **Expanded needs the tree's keyboard contract.** Taken, by making Expanded **an `expanded`
   prop on `OutlinePanel`** rather than a new component: the same `<ol role="tree">`, rows, roving
   `aria-activedescendant`, Home / End / Enter / Space. In Expanded the fit is skipped and the
   panel scrolls. This replaces "a new component `StructureExpanded`" above.
9. **`MODE_CATALOG.structure.description`** says "the sections of the one you are in", which
   Expanded contradicts. Taken.

## Built, 2026-10-01

As above, with Sol's nine plan findings handled as listed. Two things changed while building:
Expanded draws a part's children whatever they hold (a childless section is still a section, as in
the fisheye) and, below that, only nodes with children; and `?structure=` joined `REMEMBERED` in
src/web/last-view.ts (tests/last-view.test.ts caught it).

**Browser check** (a Sonnet subagent, Playwright on the box, `/read/scaling-hypothesis`, 8 parts and
34 sections): all of it passed. Wide Fisheye: columns and chips, nothing clipped, the (i) clear.
1000px Fisheye list: rung 3 with the chip row, its last row 131px above the band's foot. Expanded at
1400, 1000 and 390px: 43 rows (42 with a gist; the Notes row has none), the list scrolls and the
band and chips do not, the list follows the reader into each new section and never moves
`window.scrollY`, and a hand-scrolled list is left alone within a section. Keys: ↓ over the band
stepped one block per press, → → ← landed on section starts, and ↓ with the list focused stepped
one block. No console errors from the change. Not checked: the spine's part stride, unchanged.

**GPT Sol's code review** (`--sandbox workspace-write`, exit 0, a fresh answer): no P0 or P1. It
added Structure's view to `bandTarget`'s parsed sub-mode shape, and tests: the head row reduces the
fisheye's room, Expanded follows only on a section change and keeps a manual scroll, it re-syncs
after `display: none`, an unknown `?structure=` falls back, the face is still measured while
Expanded is open, and the metadata page's Expanded link. It noted that two of the new key tests
pin behaviour that was already there (↑ / ↓'s own stride, a handler winning) and would stay green
without `acrossDepth`; the chaining test and the guard test do go red without it.
