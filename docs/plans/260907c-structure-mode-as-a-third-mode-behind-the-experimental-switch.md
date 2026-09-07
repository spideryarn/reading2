# Structure mode, as a third mode behind the experimental switch

**Status: plan, 2026-09-07. Written before any code.** It builds
[260903b](260903b-one-structure-mode-hierarchy-and-outline-merged.md)'s *design* while deliberately
not taking its *conclusion* — see [The decision](#the-decision-and-what-it-supersedes) — and it
follows [new-mode.md](../project/new-mode.md) item by item, which
[The checklist, walked](#the-checklist-walked) records.

## The decision, and what it supersedes

260903b proposed **merging** Hierarchy and Outline into one Structure mode. An attempt on 2026-09-04
drifted from *merging two* into *adding a third* and stalled. Asked directly on 2026-09-06 whether
Structure should replace both, replace only Outline, be dropped, or be added as a third, Greg chose
the third, and said why:

> I don't know if Structure will be better, so let's build it as a third, and that way I can flip
> back and forth to compare. It'll be in the "Experimental Features" section.
>
> — Greg, 2026-09-06

So **Hierarchy stays, Outline stays, Structure joins them, and Structure is behind the switch.**
Those two halves are one decision rather than two, and losing the second half is what the 2026-09-04
attempt got wrong. A third mode was recommended against twice — by Fable and by me, on the grounds
that the band is meant to shrink — and **that objection does not survive the switch**: an ordinary
reader's bar is unchanged, because a mode behind the switch is not in it. What is being added is not
a mode for readers; it is an instrument for Greg.

**260903b's premise is superseded, not rejected.** The merge is *deferred pending a comparison that
Structure exists to make*. Whether Structure eventually replaces Outline, or Hierarchy, or neither,
is a later decision — this plan must not pre-empt it, and removes nothing.

**What this changes in 260903b's stage list.** Its stage 1 was *"Outline becomes experimental
Structure"*. It does not: Outline is left exactly as it is, and Structure is written beside it. Its
stage 3 — *"if Structure wins, delete Hierarchy's presentation"* — is not in this plan at all.
Everything else in 260903b (the Miller columns, the fit-chosen split, the fisheye ladder, the
connector, adaptive depth, Argument mode) is still the design; how much of it lands here is
[Stages](#stages) and [What is deferred](#what-is-deferred-and-why).

## What must be good, and it is not the mode

The comparison. Three views of one tree, flipped between on one article at one scroll position,
without losing your place. A v1 that is easy to flip into and out of beats a v1 with more features
that is awkward to compare against, and every trade below is settled that way.

**The URL keeps your place. The screen may not, and the first draft of this plan confused the
two** — GPT Sol's finding 1, and it is the most valuable thing the review produced.

What is true: view state is in the URL ([url-state.md](../project/url-state.md)), and pressing a
mode button does not touch `?at=`. (Not via `withMode`, which is what this paragraph originally
said and is what the *loose links* on the metadata and tweets pages use; the buttons on the reading
view call `onActivate` → `setMode`, and nuqs leaves every other parameter alone. Same outcome,
wrong mechanism named.) Structure inherits this by being an ordinary mode, and **it does not have a
position notion of its own** — it reads `focusRow` from `useColumnContext`, which is what Outline
reads and what the gist columns' context panels read. One sampler, three views.

What is **not** established is that the reader stays on the same words:

- Hierarchy has no band and keeps the gist columns; Outline and Structure open the band and drop
  them. The prose column therefore changes width, every paragraph re-wraps, and the page's total
  height changes — which is exactly why `layoutKey` carries `fit.modeW`.
- The restore effect in [`useReadingPosition.ts`](../../src/web/reader/useReadingPosition.ts)
  depends only on `at`, so it does **not** re-run on a mode change.
- The write-back effect *does* re-run on `layoutKey`, measures the freshly reflowed page, and can
  overwrite `?at=` with whichever section happens to have landed under the focus line.
- And `?at=` is section-granular anyway, so even a deliberate restore lands at a section's start
  rather than on the same paragraph.

**This is pre-existing behaviour between Hierarchy and Outline, not something Structure introduces
— and it is still this plan's problem**, because a comparison you cannot make without losing your
place is not a comparison. It is also machinery shared by all fifteen modes, so it is not something
to change on a hypothesis.

**So it is measured before it is fixed, and measured early rather than at the end.** Stage 3's
browser pass has one job before any other: scroll a long article to a known block, flip
Hierarchy → Outline → Structure → Hierarchy, and read back the block at the focus line and its
offset each time. If the place holds, this section is a false alarm and says so. If it does not,
the fix — capture a block and its viewport offset before the mode changes, restore it after the new
layout commits, and hold the scroll spy off until then — is its own piece of work on the reader's
position machinery, and it is the *first* thing to do, because every other judgement about
Structure is made through it. Sol's recommendation was to build the anchoring up front; measuring
first is the cheaper order and the one that cannot fix a bug that is not there.

## Ordering: the refactor has landed

The brief made this plan wait on `worktree-a1-a3-reader-composition`, because adding a fourteenth
mode to a 6,105-line `App.tsx` about to be split would hand its owner a conflict nobody needs.
**Checked at 11:36 on 2026-09-07 and it is in**: `origin/dev` is `b12a8fa1`, `App.tsx` is 462 lines,
[`reader/Reader.tsx`](../../src/web/reader/Reader.tsx) exists, and `src/web/modes/` holds ten
controllers (`conversation`, `debate`, `diagram`, `glossary`, `ideas`, `quotes`, `referee`, `search`,
`summary`, `timeline`). Structure is an eleventh directory beside them, in the shape they use.

*(The primary checkout said otherwise — one `ideas/` directory and a 6,282-line `App.tsx` — because
it was sitting on `d4b503b4`, several hours behind. A worktree cut from `origin/dev` has the
refactor. Worth recording: "has it landed" asked of the shared primary is a question about that
checkout's staleness, not about `dev`.)*

## What Structure draws

One projection, two layouts, and **no second tree** — the contract
[AGENTS.md](../../AGENTS.md) states and [granularity-zoom.md](../project/granularity-zoom.md)
owns. Structure reads `buildSummaryTree` at full depth, which is what Outline reads.

**Not "the same object" as Hierarchy's, and the first draft said so wrongly** (Sol). Hierarchy goes
through `buildGeometry` and Outline through `buildSummaryTree`: two projections. What all three
share is **the same stored `article.tree`**, and that is the contract that matters — one artefact,
written by stages 4 and 5 together, read three ways. A third *view* is not a third tree, and a
second projection function over one tree is not a divergence.

**Two Miller columns**, which is 260903b § P1 narrowed to what fits:

| | Column A | Column B |
|---|---|---|
| Rows | every part, one line each | the **current part's sections**, the current one expanded |
| Changes when | never (the document's shape) | you cross a part boundary |
| Greg's words | "a wider-angle flatter fisheye" | "more curved/narrower" |

Column B lists the current section's **siblings** with the current one expanded, not only its
children — Sol's amendment to 260903b, and Greg's decision 1. Paragraphs alone answer *what is
inside this section* and lose *which section am I in within this part*, which is the orientation
problem the mode exists for.

**Each column spends its height down a ladder**, measured against rendered rows and never estimated,
which is Outline's mechanism and the thing that is meant to fix Outline's half-blank panel:

| | Column A rungs | Column B rungs |
|---|---|---|
| 1 | part titles | the current part's section titles |
| 2 | + the current part's gist | + the current section's gist |
| 3 | + gists on the near parts | + the current section's paragraphs (capped, with edge counters) |
| 4 | + gists on every part | + gists on the near sections |
| 5 | | + gists on every section |

Every rung is all-or-nothing within its level, for Outline's reason: a partly-drawn level is a lie
about the structure. The two columns climb **independently** — they are measured separately, so a
short part does not hold column A down.

**Below two readable columns, the same projection stacks**: column A's rows, a rule, column B's rows.
Not a fallback to Outline and not a second projection — one `structureProjection()`, drawn two ways.
This is Greg's own framing (*"If allowed 1 column, it pretty much is Outline mode now"*) taken
literally, and it is what makes [the width question](#the-width-question-and-the-product-tweak-that-removes-it)
cost nothing.

## The width question, and the product tweak that removes it

**The band is 288–400px** — `clamp(avail − PROSE_MIN, MODE_MIN, MODE_IDEAL)` in
[`layout.ts`](../../src/web/layout.ts). 260903b called this the thing that makes a second column
*not* a small change: *"the new mode needs the width negotiation the Hierarchy columns get today,
not the band's."*

**It does not, and this is the tweak that takes most of the engineering out.** `GIST_MIN` is 176 —
"the narrowest a gist still reads at", already a measured judgement in that file. So:

> Structure draws two columns when it has room for two `GIST_MIN` tracks and a gutter, and stacks
> below that. `layout.ts` is not touched.

**The arithmetic, corrected by Sol's finding 6.** `.mode-band` has a 1px border and the page is
`border-box`, so a 400px band is 399px of content; after a 12px gutter the tracks are **193.5px**,
not 194 — still above 176, so the premise survives. The exact outer threshold for two tracks is
**365px**, not 364. And **any horizontal padding raises it**: Outline's 20px would put it near
385px, and this panel's own 12px puts it at 389px. That is a real cost of the padding and it is the
reason the threshold is not a constant in the source.

**So the layout is chosen from the measured content box, never from `fit.modeW`** — also Sol. When
the band covers the prose, `fitMode` reports `modeW: 0` while the CSS expands the band to the whole
viewport ([narrow-window.css](../../src/web/styles/narrow-window.css)), so a decision keyed on
`--mode-w` would stack the columns on the one screen where the band is *widest*. The panel observes
its own grid instead.

That is worth naming as a choice rather than a discovery, because it costs something: at 194px a
gist wraps to three or four lines where Hierarchy's 240px ideal gives it two, so column B will be
taller per row than the equivalent in Hierarchy. **If it reads badly in the browser, the next step is
the band-width negotiation, and that is a real cost** — `fitMode` is one function shared by all
twelve band modes, and widening it for one mode means either a per-mode ideal width (a new concept in
that file) or a wider band for Chat and Summary too, which nobody asked for. It is the right thing to
find out from a screen rather than to pay for in advance. Recorded here so the decision is Greg's if
it comes back.

## Churn, and the well that answers it

**Sol's finding 2, and it was a real hole: the first draft dropped the fixed-height focus well
without noticing.** 260903b's Sol memo proposed one per column — the current row and its detail live
in a region whose outer height does not change, so crossing a boundary changes the region's contents
and moves nothing below it. It is the answer to
[260828aw § What actually moves](260828aw-outline-mode.md#what-actually-moves), and it is not
optional here:

- Column A does **not** "change never", as the table above says. Its rows do; its current-row gist
  and its near-row gists do not.
- Column B inserts and removes the current section's gist and its paragraphs, so sibling rows below
  slide even though the structure they stand for has not changed.
- Two independently measured ladders can step at the same boundary, which is a third discontinuity
  on top of the other two.

That is exactly the orientation churn the mode exists to remove, and it would look polished while
producing it. So:

- **The current row's detail sits in a region with a reserved height** in each column, and the rows
  below it do not move when it fills or empties.
- **One selection model.** The current part and the current section are computed **once** from
  `focusRow`, and both columns and every rung candidate are derived from that. The independently
  measured ladders decide *how much* is drawn; they never decide *what is current*. This is the same
  rule `outline.ts`'s docblock states for its own single walk, and the reason is the same: two
  copies of "which row is the reader in" disagree without erroring.

`260828aw`'s row-displacement measurement is this mode's acceptance test, as decision 2 said it
would be.

## The connector, cheaply

Greg asked for "some kind of visual indicator of how the bits in column 1 map to the bits in column
2… kind of like a Sankey diagram"; Sol proposed an outlined taper plus bracket. Both need measured
geometry between two independently-measured columns, redrawn on every resize and every boundary
crossing.

**v1 is CSS and no geometry**: the current part's row in column A carries a right-edge marker,
column B carries a matching left-edge bracket in the same tint, and column B's quiet header is the
part's number and nothing else. That answers *these rows belong to that row* — the whole of what the
indicator is for — with no SVG, no measurement and no resize path. The drawn taper stays available
as a follow-on once we know the mode is worth keeping.

## Overflow

Greg's decision 3 was *"build ticks and edge counters both, behind a switch, and decide in the
browser"* on a long section. The first draft of this plan chose edge counters and put them on the
paragraph expansion. **Sol's finding 3 is that a paragraph counter cannot be honest, and it is
right**, so the design changed:

**`focusRow` is section-granular.** It is `sections[…].row` — the first row of the section under
the focus line — so nothing on the page knows which *paragraph* the reader is on. This is the same
fact that makes Outline refuse to mark a current paragraph
([`outline.ts`](../../src/web/outline.ts) § `PARAGRAPHS_ARE_NEVER_CURRENT`): marking the deepest row
containing the reader would light the section's **first** paragraph, every time, on every article,
and look entirely plausible while being so. A centred paragraph *window* is that same false claim
with two numbers attached to it — "12 earlier, 9 later" is a statement about where the reader is,
and we do not know.

So the rule splits by level, and the split is exactly where the honest signal stops:

| Level | Overflow device | Why it is honest |
|---|---|---|
| Parts (column A) | centred window with **edge counters** | we know which part the reader is in |
| Sections (column B) | centred window with **edge counters** | we know which section — that is what `focusRow` *is* |
| Paragraphs (inside the current section) | **all of them or none**, and when none, an honest total: *"26 paragraphs"* | we do not know which one, so there is no centre to window around |

The paragraph line is Sol's own proposal from the 260903b memo, recovered. It says the same useful
thing the window was meant to say — *this section is much bigger than its neighbours* — without
claiming a position.

**Ticks are still deferred, and the switch is not built.** Counters are text rows; ticks are new
hairline geometry and a new visual vocabulary, and the switch is a third thing to build and then
delete. This remains a declared deviation from half of decision 3.

**Paragraph rows also obey `paragraphLabelsReady`** (Sol). Outline withholds that whole layer while
stage 5's labels are still being written, rather than drawing blanks that read as missing article
structure; Structure takes the same rule from the same input.

**The base rungs need the device too, and the first draft said they did not.** It claimed nothing
else overflows because "the widest part count is 15 and the widest section count 23" — **both
numbers are wrong**, and there is no way to get the right ones from here. Sol measured this
worktree's `data/` and found 8 parts, 7 sections and 26 paragraphs; but `data/` in a worktree is
the **fixture cut** copied by `npm run worktree:setup`, not the corpus, so those are numbers about
the fixtures. The documented corpus figures are 260903b's — a Constitution part with 15 sections,
sections with 23, 16 and 15 paragraphs, and Noema's 26 — and they were measured on a full `data/` in
September. **This plan cites those and claims no measurement of its own.**

Either way Sol's structural point stands and does not depend on the number: *"the ladder does not
climb" does not protect a base rung that itself cannot fit.* Column A's parts and column B's
sections are mandatory — there is no lower rung to fall to — so on a short viewport, or on a future
tree, the base list can overflow with nothing to do about it. Hence the window and counters on both
sibling levels above, and a short-panel case in the tests rather than only a narrow one.

## Why Outline's measuring code is copied rather than shared

`OutlinePanel`'s build-every-candidate / render-hidden / measure-`scrollHeight` / take-the-tallest
loop is about sixty lines, and Structure needs it twice (once per column). The obvious move is to
extract a hook and have both panels call it.

**Not in this piece of work.** Outline is one of the two things being compared against, and a change
to it — even a pure extraction — changes what the comparison is measuring, in the one week where
that matters. Structure gets its own copy; the extraction is worth doing *after* Greg has decided
what survives, when at most one of the two callers is still there. Named here so the duplication is
a choice on the record rather than something a later reader has to reverse-engineer.

## What is deferred, and why

| Deferred | Why |
|---|---|
| **Adaptive, uneven tree depth** (260903b § P4, decision 6) | A stage-4 prompt change plus a depth-agnostic sweep of `outline.ts`, `position.ts`, `tree.ts`, `Spine.tsx` and `diagram.ts`. It is the largest single item in 260903b and it changes the artefact every other mode reads. Structure on today's three-deep trees answers the question this mode was built to ask; adaptive depth is worth doing when it is not also a comparison. |
| **The drawn taper / Sankey** | [above](#the-connector-cheaply) |
| **Ticks as an overflow device, and the switch between the two** | [above](#overflow) |
| **The hover card on a row** — its gist and its children, from Greg's decision 5 | **A third declared deviation, and Sol caught it being attributed to Greg rather than declared.** Decision 5 has two halves: *rows jump* (built) and *hovering shows a card* (not). The first draft folded the card in with "look-without-going", which is a different idea — inspection focus retargeting the columns — that Greg did not ask for and this plan does not build either. The card is a small follow-on and needs the spine's tooltip machinery; it is deferred on cost, not on Greg's answer. |
| **A fixed-height focus well per column** | **Not deferred — built, and its absence from the first draft was Sol's finding 2.** See [Churn](#churn-and-the-well-that-answers-it). |
| **Argument mode, and the arc leaving Structure** (260903b § P5, decision 7) | Structure v1 draws **no arc at all** — no L0 column, no rung 4. That is 260903b's endpoint reached by not building the thing rather than by moving it, and it leaves Outline's rung 4 exactly where it is. Argument is its own plan. |
| **The fit-chosen level split** (decision 2) | **Reversed now, not postponed — and the first draft's reason for it was false.** It said "today's trees are three deep, so there is nothing to choose between": Sol's finding 7 points out that even at three levels there is a live choice, `[parts][sections+paragraphs]` against `[parts+sections][paragraphs]`, and Greg picked fit over stability for exactly that. The honest reason for going the other way is decision 1: it gives each column a *stable semantic job* — A is the document, B is the part you are in — and a split chosen by fit takes that away at every part boundary. This plan values the stable job and lower churn above fuller columns, which is a reversal of Greg's answer and is his to overturn. |
| **`?text=0` and the full-contents sheet** (decision 4) | Both belong to deleting Hierarchy, which this plan does not do. |
| **Look-without-going on hover** (decision 5) | Rows jump, as today. Greg's own answer. |
| **Extracting the measured-fit hook** | [above](#why-outlines-measuring-code-is-copied-rather-than-shared) |

## The checklist, walked

[new-mode.md](../project/new-mode.md), item by item. Structure **generates nothing** — it draws the
tree that is already in the page's payload — so the whole second half of that checklist (the
artefact, the step, the SQL CHECK, the export put-chain, the public projections, `PROMPT_VERSION`,
the prompt-language rule) does not apply. That is the same line Outline, Hierarchy, Plain and Search
sit on.

**The compiler-forced tables** — all in stage 1, because `structure` in `MODES` is red until each has
a row:

| Table | What Structure's row says |
|---|---|
| `MODE_LABEL` ([`title-text.ts`](../../src/title-text.ts)) | `Structure` |
| `OWNER_MODE_NOTE` ([`messages.ts`](../../src/messages.ts)) | written in stage 1 |
| `MODE_CATALOG` ([`mode-catalog.ts`](../../src/mode-catalog.ts)) | `description`, `how`, `aliases`, **`experimental: true`** — [the card](#the-card) |
| `MODES_UI` ([`Dock.tsx`](../../src/web/Dock.tsx)) | a row and an icon, placed next to Hierarchy and Outline, which is where the structural views sit |
| `POLICY` ([`visitor.ts`](../../src/web/visitor.ts)) | **a visitor sees the whole of it**, as they do Outline: the tree is in the payload every reader already holds, nothing is fetched and nothing costs anything |
| `BAND_SAYS` (`tests/public-network-trace.test.tsx`) | what the visitor's band says, asserted against a network trace of zero requests |
| `MODE_TARGET` ([`activation.ts`](../../src/web/activation.ts)) | `none`, with the reason in a sentence — pressing it spends nothing |
| `SPENDS` / `DRAWS` (`tests/every-mode-draws-its-surface.test.tsx`) | spends nothing; draws a band, so a positive `kind` row, written independently of the tables above |
| `band()` ([`reader/Reader.tsx`](../../src/web/reader/Reader.tsx)) | a real arm from stage 1 — not `null`, and not a placeholder |
| `selectPassages` ([`reader/passages.ts`](../../src/web/reader/passages.ts)) | `NO_FOUND`, explicitly. Structure marks no passages in the prose; it is navigation, like Outline and Hierarchy |

**The residue nothing checks** — each answered here so none is answered by silence:

- **URL params** — **none.** Structure adds no parameter. The column count follows the width, which
  is 260903b § P3 ("no pills") for free, and there is no `?cols=`. Position is `?at=`, which already
  exists.
- **A resolver in `search-hits.ts`** — not applicable; no passages, so no `Found`.
- **A read hook** — none. Nothing is fetched.
- **`auto-run-targets.ts` / `useAutoRun`** — **deliberately not**, and it is the same reason Plain,
  Hierarchy and Outline are not in it: opening a mode that generates nothing has nothing to start.
- **Band chrome** — **no `.band-head`**, which is the documented default since 2026-09-05. Column B's
  part number is inside column B, not a title row, and the Dock is already saying the mode's name.
- **`CACHEABLE`** — not applicable; no GET.
- **The dock's mode page, and the line in
  [reading-view-overview.md § The modes in the band](../project/reading-view-overview.md#the-modes-in-the-band)**
  — stage 1, pointing at this plan, since there is no `structure.md` yet (the same arrangement
  Outline and Debate have).

**Moving it in or out of the switch** is that doc's three edits, and stage 1 does all three: the
`experimental: true` flag, the name in `BEHIND_THE_SWITCH`
(`tests/dock-experimental-modes.test.tsx` — an independent copy on purpose, so six of its tests go
red if somebody moves a mode by editing one boolean), and **the row and the reason in
[experimental-features.md](../project/experimental-features.md)**, which owns the argument.

**Nothing should count the modes, and two things did.** The first draft of this plan stated the
rule as a fact; Sol checked it and it was false.
[`tests/page-head.test.ts`](../../tests/page-head.test.ts) asserted `MODES.length === 14` as a
positive control, and `tests/every-mode-says-which-passages-it-marks.test.ts` named "the nine modes"
in a test title. Neither could catch anything its own loop over `MODES` did not already catch — what
they caught was somebody adding a mode, and made them edit arithmetic to say so, which is the
bookkeeping [new-mode.md](../project/new-mode.md) measured at eight places for one line of
behaviour. The count in the first is replaced by the thing it was incidentally doing — a floor that
says the loop is not passing over an empty list — and the second is reworded. Identities go against
`BEHIND_THE_SWITCH`; everything else derives from `MODES`.

**Three tables the checklist did not name**, found by running it rather than reading it, and now
added to [new-mode.md § Before you call it finished](../project/new-mode.md#before-you-call-it-finished):
`GENERATES` in [`tests/command-bar.test.tsx`](../../tests/command-bar.test.tsx) (Sol), and both
`SPENDS` **and** `DRAWS` in `every-mode-draws-its-surface.test.tsx` counting as two errors rather
than one. Four more went red without the typecheck: `ALWAYS_FREE` and the gap walk in
`visitor-gaps.test.ts`, the `named` map in `page-title.test.ts`, and `MANIFEST` in
`styles-entry-is-imports-only.test.ts` — the last because a new mode with its own stylesheet has to
say where in the cascade it loads.

### The card

`description` and `how`, to [tooltips.md](../project/tooltips.md)'s rule — the first is what a press
would have told them, the second is what it would not. The known failure of this job is a *plausible
invention* in the second half, so both are written from the source and checked against it. Draft, to
be checked in stage 1 rather than trusted here:

- `description` — *"The document's shape in two linked columns: every part, and the sections of the
  one you are in"*
- `how` — *"The same already-built tree as Hierarchy and Outline, so there is nothing to generate.
  The two columns are read left to right: the second one is always the inside of the row marked in
  the first, and it re-fills as you cross into a new part."*

No price, no "opening it runs", nothing already on screen, and not a reword of the first.

## The loose end in `src/modes.ts`

[`src/modes.ts`](../../src/modes.ts)'s `outline` entry says the mode is *"a second answer to a
question an existing surface already answers"* and that this is **"deliberate and temporary"**,
citing Greg wanting to compare it against the gist columns' context panels. That was written around
2026-08-28 and the reconciliation never happened; **Greg has now kept Outline**, so the comment says
the opposite of the decision. It is corrected in stage 1 to say Outline is staying, citing
2026-09-06 and this plan. **Outline itself is not touched** — only the sentence about its future.

`experimental-features.md` carries the same stale claim in prose — *"Hierarchy and Outline are both
stand-ins for the merged Structure mode… when that lands those two become one"* — and gets the same
correction in the same stage.

## Stages

Each ends with a GPT Sol review and a commit; the code review at the end of a stage is weighted
above the plan review, per [AGENTS.md](../../AGENTS.md).

**Recut after the review.** The first draft's stage 1 registered the mode with a one-column panel
while its Dock card described "two linked columns" — Sol's finding 4, and it is not a cosmetic
problem: the card is what a reader is shown before pressing, an experimental reader would meet it
immediately, and `?mode=structure` is deliberately reachable by anyone. **A mode is not registered
until its description is true of it.** So the vocabulary and the projection land together.

**Stage 1 — the word, the tables, and a truthful two-column band.** `structure` in `MODES`; every
compiler-forced total including `GENERATES` in `tests/command-bar.test.tsx`, which
[new-mode.md](../project/new-mode.md)'s measured list did not name (finding 4) and which is now
added to it; `BEHIND_THE_SWITCH`; the `band()` arm and a `src/web/modes/structure/` controller
owning its own tree and focus sampler. `src/web/structure.ts` — `structureProjection()` →
`{ columnA, columnB }` from **one selection model**, pure and with no DOM, tested against hand-built
trees rather than against `data/`, which is gitignored and is the fixture cut in a worktree
(finding 4's last line, and a thing this session had already been bitten by). A panel that draws
both columns from it, without the measured ladders. The doc corrections and additions, and
`src/modes.ts`'s two entries.

**Stage 2 — the ladders, the wells, and the fit.** One Structure-local measuring hook called twice
(Sol: one hook, two calls, not two copies), with the traps `OutlinePanel` documents — candidates
laid out at exactly the real column's width and padding, one observer per candidate, a re-measure on
font change, and equal heights breaking toward the *lower* rung. The reserved-height wells, the
window and counters on both sibling levels, the paragraph all-or-nothing with its honest total,
`paragraphLabelsReady`, the two-column/stacked choice made from the **measured grid** rather than
from `fit.modeW`, the CSS bracket, and the keyboard and touch targets
([keyboard.md](../project/keyboard.md), [touch.md](../project/touch.md)).

**Stage 3 — the browser, and its first job is not Structure.**

1. **Does flipping keep your place?** Before anything else, and on a long article: scroll to a known
   block, flip Hierarchy → Outline → Structure → Hierarchy, and read back the block at the focus
   line and its viewport offset at each step. This is the measurement
   [§ What must be good](#what-must-be-good-and-it-is-not-the-mode) turns on, and if it fails, fixing
   it outranks everything else in this plan.
2. **Switch off**: the bar and the band exactly as they are today. The half that protects every
   reader who is not Greg.
3. **Switch on**: flip all three at one scroll position, at 1280 and at a width that stacks, and at
   a short viewport, which is the case the base-rung overflow needs.

Done in a subagent, telling it to kill its own dev-server PID rather than `pkill -f vite`, with
screenshots to absolute scratchpad paths.

## Open questions for Greg — nobody is in the chat to answer these

Recorded rather than asked, and each has an assumption this plan proceeds under.

1. **194px columns.** Assumed readable, on `GIST_MIN`'s authority. If they are not, the answer is
   either a wider band for every mode or a per-mode ideal width, and both are Greg's call —
   [the width question](#the-width-question-and-the-product-tweak-that-removes-it).
2. **Counters and not ticks.** Half of decision 3, deferred on cost. If the counters read as clutter,
   ticks are a small follow-on.
3. **Where Structure sits in the bar.** Placed beside Hierarchy and Outline, because the three
   structural views belong together and the comparison is a matter of pressing three adjacent
   buttons. The bar's order is Greg's, so this is the easiest thing in the plan to move.
4. **The icon.** Picked from `lucide-react` in stage 1 and named in the commit, so it is one line to
   change.

## What the plan review changed

GPT Sol reviewed this before a line of the mode was written
([the prompt](260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch-sol-plan-prompt.md),
[the review](260907c-structure-mode-as-a-third-mode-behind-the-experimental-switch-sol-plan-review.md)).
Its verdict was that the direction is sound and the plan needed revising first. Eight findings; six
changed the design, and the plan above is the revised one rather than the reviewed one. Recorded
here so the reasoning survives the edit:

| Finding | What it changed |
|---|---|
| 1. Scroll preservation is not free | The claim was wrong in its mechanism (`withMode` is not what the buttons call) and unproven in its substance (reflow can overwrite `?at=`). It is now a measurement taken **first** in the browser, with the fix named. |
| 2. The fixed focus wells had silently vanished | [Churn](#churn-and-the-well-that-answers-it) is new. Wells are built, and one selection model feeds both columns. |
| 3. Paragraph edge counters cannot be honest | Correct, and it turns on the same fact that stops Outline marking a current paragraph. Counters keep the two levels where the signal exists; paragraphs get all-or-nothing plus a total. `paragraphLabelsReady` added. |
| 4. `GENERATES` missing; "nothing counts the modes" was false; stage 1's card would have lied | The table has `GENERATES`; `page-head.test.ts`'s literal 14 became a non-vacuity floor; the stages are recut so the mode registers only with a true description. |
| 5. Corpus maxima wrong | They were, twice over — and Sol's replacements are measurements of the *fixture* cut, so the plan now cites 260903b's documented figures and claims no measurement. The structural half of the finding — a base rung has no lower rung to fall to — is built. |
| 6. Box arithmetic | 193.5px not 194, threshold 365 not 364, padding raises it, and the layout choice must come from the measured grid rather than `--mode-w`, which reads 0 on the screen where the band is widest. |
| 7. Decision 2's stated reason was false; decision 5 half-deferred without saying so | Both rewritten as declared deviations with honest reasons. |
| 8. The public fixture cannot tell a two-column band from a one-column one | Its tree has a root and one part and no section, so a `BAND_SAYS` assertion on the part title passes with column B absent. The fixture gains a section and the assertion observes both columns. |

Two findings were checked and **not** taken as recommended: the anchoring in finding 1 is measured
before it is built, and the corpus numbers in finding 5 are not adopted. Both are argued where they
sit.

## References

- [260903b](260903b-one-structure-mode-hierarchy-and-outline-merged.md) — the design, the mockup, the
  Sol memo, the nine decisions. Its *conclusion* is superseded by this plan's first section; its
  *thinking* is the source for everything above.
- [260903a-fisheye-hierarchy-ui-prior-art.md](../research/260903a-fisheye-hierarchy-ui-prior-art.md)
  — Furnas's degree-of-interest rule, Miller columns, and why the combination looks unbuilt.
- [260828aw-outline-mode.md](260828aw-outline-mode.md) — the rung ladder, the churn measurement, and
  the corpus table this plan's ladders are shaped from.
- [new-mode.md](../project/new-mode.md) · [experimental-features.md](../project/experimental-features.md)
  · [granularity-zoom.md](../project/granularity-zoom.md) · [hierarchy.md](../project/hierarchy.md)
  · [column-context.md](../project/column-context.md)
- [`src/web/outline.ts`](../../src/web/outline.ts) · [`OutlinePanel.tsx`](../../src/web/OutlinePanel.tsx)
  · [`tree.ts`](../../src/web/tree.ts) · [`layout.ts`](../../src/web/layout.ts)
  · [`reader/Reader.tsx`](../../src/web/reader/Reader.tsx)
