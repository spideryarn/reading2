# Annotations mode: marginalia in a right-hand column

**Status:** planned 2026-10-01. Two of Greg's reports, one mode:
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
  - the **Socratic question** of each depth-1 section beside its first block, and the article's own
    (the root's) beside the first block;
  - **Ideas**, if the reader has already made them: beside each block an idea occurs in, a small
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
