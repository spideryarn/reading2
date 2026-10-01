# Annotations mode: marginalia in a right-hand column

**Status:** stage 1 built and landed 2026-10-01 (§ Status, below). Two of Greg's reports, one mode:
SPIDERYARN-READING2-7E (report `spya-u3dgk7`) and SPIDERYARN-READING2-7K (report `spya-w2kgha`),
both from `/read/dongetal25-spya-vfmvmm`. Experimental, behind the switch
([experimental-features.md](../project/experimental-features.md)), built to
[new-mode.md](../project/new-mode.md).

## The ask

> I think we had suggested in another Feedback report to try adding an experimental Annotations
> mode, that would provide marginalia-snippets that scrolls with the text, i.e. anchored to the
> blocks visible on screen. Some ideas (taking some inspiration from the `decorated.html`
> experiments & research:
> - include the "relation-words", e.g. BUT, SO
> - perhaps include socratic-questions for what each section is answering
> - used dashed-underline with hover-tooltips for Ideas/Assumptions
> - add some kind of Arc-rail sentence at the top (and/or the Structure-breadcrumbs that I think I
>   mentioned in another Feedback report)
> - if you think a block is really important but really difficult, we could automatically trigger
>   the ask-for-help question-comments?
>
> — Greg, 2026-09-30 (SPIDERYARN-READING2-7E)

> I would love to play with putting that new Annotations mode as a column on the right-hand-side
> (i.e. right of the text).
>
> Then left-hand-column (if displayed) would be stuff that's unanchored to the text, middle column
> for the text itself, and right-hand-column (if displayed) for annotations anchored to the blocks.
>
> This raises lots of questions about whether both left- and right-hand columns can be visible at
> the same time (ideally yes, if the window is wide enough, otherwise probably only one or the
> other), etc etc.
>
> For now, let's say that Annotations mode is the only one that can appear in this
> right-hand-column, though we'll see in future.
>
> — Greg, 2026-10-01 (SPIDERYARN-READING2-7K)

And from the same night, on Summary mode (7B): no description line in a mode — *"they waste
space"* ([new-mode.md § No description line](../project/new-mode.md)).

## Prior work

Nothing in flight: no plan, note, commit or live session on annotations, marginalia or a right-hand
column (checked 2026-10-01 03:15 — `docs/plans/`, `docs/user-feedback/`, `git log origin/dev`,
`gjd-remote ls`; the one `fb7e-…` session is this one). The material this draws on:

- [260828c-decorated-mode-ideas.md](../research/260828c-decorated-mode-ideas.md) and
  `experiments/decorated/` — the 168-idea catalogue and the playground. Its relation words
  ("connectives") came from a one-off annotation script, not from any pipeline step.
- [260905e](260905e-feedback-diagram-text-column-and-socratic-summaries.md) — the Socratic
  `question` already on the tree's root and depth-1 nodes, shown today only in Summary.
- The arc (`useArc`, one sentence per part) — shown today only in Structure's list face.

## Two product views, and what they agreed

Opus and GPT Sol were each given the same brief (`logs/fb7e/product-brief.md` in the worktree,
not committed) and answered independently. They agreed on every structural question:

1. **A mode, not a toggle, for v1.** `?mode=annotations` opens no left band and draws the right
   column. A separate right-column toggle that coexists with a left band means two optional
   columns, a width split between them and mode combinations — all before Greg can try anything.
   **Keep the column a component that knows nothing about modes**, so the toggle is a URL param and
   a layout change later rather than a rewrite.
2. **Free content first**: the Socratic questions (both ranked them first: reading to answer a
   question is the most vision-aligned of the five), then the arc, then Ideas *if already made*.
3. **Relation words: deferred.** Both said a new paid pipeline step is disproportionate before the
   surface itself has been tried. Opus: *"yes, as stage 2, but only after Greg has tried stage 1"*.
   Sol: *"probably the best eventual dense annotation"*. When built: classify every paragraph,
   draw only the turns.
4. **Cut the automatic ask-for-help comment.** It spends money and writes into the reader's own
   data without being asked, needs a difficulty score we do not have, and asks the question on the
   reader's behalf.
5. **Narrow windows: hide the notes, do not put them inline.** Inline notes mix the machine's voice
   into the author's sequence and risk landing in what a reader copies.
6. **The risk against [vision.md](../project/vision.md) is a second article down the margin.**
   Keep it sparse: questions per top-level section, never a gist or label per paragraph.

They differed on breadcrumbs (Opus: yes; Sol: at most the current section title, since the spine
already shows structure). Taken: **the current section's path, one line, shortest form** — the
part and the section, which is Sol's "current section title" plus the one ancestor that says
where it sits.

## What v1 is

```
 spine │            prose (where Plain puts it)           │  annotations column
       │                                                  │ ┌──────────────────────┐
       │                                                  │ │ Part 2 › Methods     │  ← head, fixed:
       │                                                  │ │ The argument turns   │    current section
       │                                                  │ │ from … to …          │    + the part's arc
       │                                                  │ └──────────────────────┘
       │ ## 2. Methods                                    │  Why would a model     ← the section's
       │ Lorem ipsum dolor sit amet …                     │  need to …?              Socratic question
       │ … consectetur adipiscing …                       │
       │ Ut enim ad minim veniam, quis …                  │  ASSUMES · Scaling     ← an Idea occurring
       │                                                  │  laws hold               here (tooltip: the
       │                                                  │                          statement)
```

- **The column** sits to the right of the prose, each note level with the top of its block and
  scrolling with the page (the window scrolls; nothing here listens to scroll). Where two notes
  would collide, the later one is pushed down — one pass, in document order.
- **The prose stays where Plain puts it** while there is room beside it for the column; only when
  there is not does the column push the centred prose left, and then narrow it, down to the band's
  own floor (`MODE_PROSE_FLOOR`). Below that, no column (see Narrow, below).
- **The head**, pinned at the top of the column: the current section's path (part › section) and
  the arc sentence for the part you are in. Without an arc (a visitor, or before it is written) it
  is the path alone, and looks complete.
- **Notes, per block**:
  - the **Socratic question** of each depth-1 part beside its first paragraph (the article's own,
    the root's, was dropped in the design pass below);
  - **Ideas**, if the reader has already made them: beside the first block each idea occurs in, a small
    stamp — *assumes* or *introduces* — and the idea's short name; the full statement in a tooltip.
    Annotations never starts the Ideas job.
- **Visibly ours**: small sans, faint ink, no hue — the accent belongs to the reader's own marks
  (the channel budget in 260828c). `user-select: none`, so a copied paragraph carries none of it.
- **No description line** (Greg, 7B). The mode's card on its Dock button says what it is.
- **Owner and visitor alike**: everything it draws is free and in the payload or a stored read, so
  `POLICY` gives a visitor the same column (Ideas only where a visitor can already read them).

### Narrow windows

Below the width where the column fits beside `MODE_PROSE_FLOOR` of prose, the column is not drawn;
the head stays, at the top right, saying the notes need a wider window. A mode that silently draws
nothing looks broken (Opus); a sentence saying why is an empty state, not a description.

## The layout

New in [`layout.ts`](../../src/web/layout.ts): a `margin` input to `fitView`, giving `Fit` a
`margW` (the column's width, `0` when it does not fit) and `margReserve` (how much room the
`.reader` must keep free on its right). Pure, so `tests/layout.test.ts` can sweep widths.

```
avail       = window − spine
margW       = clamp(avail − PROSE_MIN, MARG_MIN, MARG_IDEAL), or 0 if avail − MARG_MIN < MODE_PROSE_FLOOR
proseW      = min(proseAloneMaxPx, avail − margW)
margReserve = max(0, 2·margW + proseW − avail)      // 0 while centring already leaves room
```

The last line is why the prose does not move on a wide screen: the table is centred
(`.text-alone`) in a content box `avail − margReserve` wide, so its right edge is at
`(avail − margReserve + proseW)/2`, and the column fits after it when that plus `margW` is at most
`avail`.

**The notes live inside each block's `td.text`**, absolutely positioned at `left: 100%`, through a
`margin` map prop on `TableView` shaped like `quizAfter` — so they scroll with their row and sit
level with it with no measurement at all. Measurement is only for collisions: a hook reads every
note's natural top and height (all reads, then all writes), runs the pure
`layoutNotes(tops, heights, gap)`, and writes a `translateY` to the few that need it. It re-runs on
a `ResizeObserver` over the table (zoom, images, maths, fonts) and when the notes change. Notes are
absolute, so they cannot resize the table and loop the observer.

**No library.** A Sonnet web pass (2026-10-01) looked at Tufte CSS (no collision handling), Gwern's
sidenotes.js (tied to its own DOM), the `sidenotes` npm package (React, but built around a selected
note pulling others aside — a comment-thread model), Floating UI (one element at a time) and CSS
anchor positioning (Baseline only in 2026, and stacking needs typed `attr()` that Safari and
Firefox lack). The collision rule is ten lines; everything else is our own glue either way.
[third-party-library-selection.md](../reusable/third-party-library-selection.md).

## GPT Sol's plan review, and what changed

`logs/fb7e/plan-review-sol.md` in the worktree (not committed); verdict *build with fixes*, no P0.

| | Finding | Taken? |
|---|---|---|
| F1 P1 | the reserve must cover the whole outward extent, and reach `minWidth` | **Yes.** `margW` is the note's whole border box, its gap included as padding, so the formula holds as written; `minWidth` carries `margReserve`; `tests/layout-margin.test.ts` sweeps 300–3290px, both rails, roots 12/16/20, for no overflow. The masthead is checked in the browser rather than in arithmetic. |
| F2 P1 | `layoutKey` did not change when Annotations reflowed the prose (`modeW` stays 0) | **Yes.** `tableW` and `margReserve` joined the key. |
| F3 P1 | the boundary would guard an empty slot | **Yes.** `modeBand()` returns the head and the owner's ideas read, so those are inside the mode's boundary (`AnnotationsHead` is the witness, owner and visitor); the notes in the cells carry a boundary of their own per block (`MarginNotesSlot`), tested to lose the note and keep the article. |
| F4 P1 | the collision pass must be idempotent | Already was: the wanted top is the *row's*, which no translate moves, and the translate written is absolute. Tested on the pure function. |
| F5 P2 | observe the notes as well as the table | **Yes**, plus once on `document.fonts.ready`. |
| F6 P1 | owner/visitor ideas seam explicit | Already: `POLICY` is `available`; visitor ideas only from the payload; `useIdeasRead` (never `useIdeas`) mounted only on the owner's path inside the mode. |
| F7 P2 | memoise the notes map | Already: on tree, blocks and ideas only; the `at`-driven head is outside it. |
| F8 P2 | idea stamps as real buttons, tap-openable | **Yes**: a button with a controlled card. |
| F9 P1 | the narrow message over the opening lines; no herald | **Message moved** to the foot, above the dock. **Herald not given**: it stands on a band's foot, there is no band, and the column appearing is itself the answer to "what did that press do". Recorded rather than built. |
| F10 P2 | every occurrence stamped could be ~50 notes | **Yes**: one stamp per idea, at its first occurrence. |
| F11 P2 | last-view regression test | **Yes.** |
| F12 P3 | "depth-1 section" | Fixed: questions are on the root and each depth-1 **part**. |

## The browser, then GPT Astra's design pass

A Sonnet subagent drove the built mode in Playwright on the box (article `love-spya-kwm06n`, 75
rows, 11 notes) and measured rather than looked: at 1600px the table was at x 402–1210 in Plain
and in Annotations alike; 0 overlapping notes at every width; no horizontal scroll at 1600, 1100
or 800; at 500px no notes and the narrow line clear of the dock; a selection across two annotated
paragraphs carried none of the notes; no console errors of ours. What it found wrong was the head.

Greg asked for GPT Astra's help with the look (7K), so the screenshots went to Astra with the
channel-budget constraints. Its eight points, and what happened to each:

| | Astra said | Taken? |
|---|---|---|
| 1 | the head as a card dominates the margin (seven lines of arc at 800px) | **Yes**: no box; path on one line, arc clamped at three, the whole arc in a card |
| 2 | notes peek through the gap above the head | **Yes**: flush under the bar, page behind it, a 12px fade below |
| 3 | questions sit beside headings and the date line | **Yes**: beside each part's first gistable paragraph (`firstParagraph` in notes.ts) |
| 4 | the article's own question runs into the first part's | **Yes**: dropped; one question per part |
| 5 | italic questions read like the author's italic synopsis; add an "AI annotations" label | **Upright, soft ink, yes. The label, no** — Greg asked the same night for no description lines in modes (7B), and small sans with no hue is the voice the research gives the machine |
| 6 | idea stamps look like incidental prose | **Yes**: an 11px semibold uppercase stamp, the name dashed |
| 7 | three different left edges | **Yes**: one edge, `--marg-gap` past the table; the question's rule hangs in the gap |
| 8 | cards cover the passage; the narrow notice floats over prose | **Cards open below**, over the column. **The notice stays** a floating line above the dock: a dock row is a change to the dock for one experimental mode |

## GPT Sol's code review

Write-capable, on `1a60d690..07ef6ce6` (`logs/fb7e/code-review-sol.md` in the worktree, not
committed). Verdict **land**. It fixed two P2s itself, each with a test seen red first, and
reported one P3:

- **C1, fixed** — the head did not share the shell's `top` transition, so it jumped when a
  visitor's controls bar slid away (shell.css and narrow-window.css's reduced-motion list).
- **C2, fixed** — on a narrow window the generic small-screen banner ("a panel covers the
  article") showed beside the mode's own "needs a wider window" line, and was false.
- **C3, P3, fixed by me** — comments here and in notes.ts still said the article's own question
  was drawn after the design pass dropped it.

It checked and passed: the collision pass's triggers and cleanup (StrictMode-safe, no observer
loop), the owner's ideas read (no loop, cleared on teardown, never on the visitor path), every
consumer of the `bandOpen` split, the arithmetic with safe-area insets, focus and stacking, and
the catalog card's claims against the code.

## Status

**Stage 1 landed on `dev`, 2026-10-01.** Stage 2 (relation words) is proposed, not built.

## Stages

### Stage 1 — the mode, the column, the free content

1. `annotations` in `MODES`, and the rows the compiler then asks for (new-mode.md § The client):
   `MODE_LABEL`, `OWNER_MODE_NOTE`, `MODE_CATALOG` (`experimental: true`, aliases *marginalia,
   margin notes, notes in the margin*), `MODES_UI` (group with Structure/Summary), `POLICY`
   (free), `MODE_TARGET` (`none` — it generates nothing), `modeBand()` → `null`,
   `MODE_CONTAINMENT`, `selectPassages` → `NO_FOUND`; tests `BAND_SAYS`, `SPENDS`, `DRAWS`
   (`kind: "none"` with the column as the positive control), `GENERATES`, `BEHIND_THE_SWITCH`,
   `ALWAYS_FREE`, `named`, `SILENT`, the dock order, the surface shapes.
2. `bandOpen` stays false for it (no left band); `fitView` takes `margin`.
3. `src/web/annotations/` — the pure parts (`annotationNotes(tree, ideas, blocks)`,
   `layoutNotes`, `sectionPath(tree, at)`, `arcFor(arc, at)`) each unit-tested, and the components
   (`AnnotationsHead`, `MarginNote`, `useMarginLayout`).
4. `annotations.css`'s neighbour `marginalia.css`, placed in the styles `MANIFEST`.
5. Docs: a line in reading-view-overview.md § The modes in the band, a row in
   experimental-features.md, and this plan updated.
6. Browser check in a Sonnet subagent (Playwright, on the box), wide / medium / narrow, owner with
   and without Ideas, screenshots read by me.

**Done when:** on the dongetal25 article, the column draws its questions beside their sections,
the head follows the reader, no two notes overlap, the prose does not move on a 1600px window, and
the gates are green. GPT Sol reviews the code (write-capable, fixes inside the stage).

### Stage 2 — relation words: proposed, not built

Written up, not built, on both advisers' word. The shape when Greg wants it: a `relations` step
(one model call per article; one word per prose block from a closed list — *so, but, why, e.g.,
vs, closer, wider, new, and-also*), stored as an artefact column, started by pressing the mode
(`MODE_TARGET` `fixed`), drawn as a small-caps word at the top of a block's note, *and-also* stored
but never drawn. A word, never a symbol, with the reason in a tooltip (260828c § A symbol that
needs a tooltip has already failed).

## Deferred, named

- **Relation words** — stage 2 above.
- **Dashed underlines for Ideas in the prose** — a second mark competing inside the author's text,
  and quote anchoring is fragile; learn first whether the margin stamp is enough.
- **The left band and the right column at once** — Greg's "ideally yes"; the column component is
  mode-agnostic so this is a URL param and a width split when wanted.
- **Automatic ask-for-help comments on important-but-hard blocks** — cut: it spends and writes
  reader data unasked, and needs a difficulty score we do not have.
- **Read-first ink** (notes appear only once you have dwelt beside a block) — 260828c's strongest
  structural idea, a good second experiment.
- **The reader's own comments in the column** — the research gave the right margin to the reader;
  the notes are kept faint and hueless so comments can join later without being mistaken for ours.

## The simpler option passed over

**Notes inline after each block** (the `quizAfter` slot exists) — no layout arithmetic, no
collision pass, and it works on a phone. Passed over because Greg asked for a column beside the
text in so many words, and because both advisers independently ruled inline out: it interleaves the
machine's voice with the author's sequence.
