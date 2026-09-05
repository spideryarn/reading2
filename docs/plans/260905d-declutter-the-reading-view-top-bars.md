# Declutter the reading view's top bars

**Status: planning, 2026-09-05.** Worktree `declutter-top-bars`, branch
`worktree-declutter-top-bars`, off `dev` at `d0bdb31c`.

The reading view's sticky chrome has accreted one control at a time, each one defensible on its own,
and the sum is a bar a reader cannot parse. This is the pass that takes things out.

## What Greg asked for

Verbatim, 2026-09-05:

> The top bars are really crowded and confusing. e.g. in Outline mode, we don't need the "Spine"
> button (let's just default to always showing it), we don't need `MODE    OUTLINE` or the `X` or
> the `UP DOWN SECTIONS` or the `toc/2` with dotted lines around them. They're all unnecessary and
> confusing.
>
> I think we can rely on the bottom bar to tell us what mode we're in, so for example "Summary" mode
> doesn't need to say `Summary` at the top, nor do any other modes.
>
> For Hierarchy mode, let's get rid of the "Arg" button and functionality altogether (or perhaps
> better still, move that into its own Experimental-Features mode - which I think another agent was
> working on). And get rid of `auto` and `READING` and `UP DOWN PARAGRAPHS` etc too. In fact, I'm
> even wondering if we can get rid of the row of column-header-labels in Hierarchy mode (`PARTS L1`,
> `SECTIONS L2`, `PARAGRAPHS L3` etc, to save on vertical space.
>
> In short, we'd like to get to the point where there's a single top bar and a single bottom bar,
> along with the nice way that we already hide/reveal those when scrolling on mobile. And that
> everything we're showing is useful and understandable.

## What is on screen today

Measured against production, 2026-09-05, `www.spideryarn.com/read/nagel-bat?at=spya-ettt2z`, signed
out, at 1440×900 and 390×844. Screenshots in this session's scratchpad; the inventory is the durable
part.

`.controls` — [`App.tsx`](../../src/web/App.tsx) § the controls bar — left to right:

| | Hierarchy | Plain | A band mode |
|---|---|---|---|
| `ViewOnlyChip` | visitor only | visitor only | visitor only |
| `Spine` toggle | ✓ | ✓ | ✓ |
| `GRANULARITY` label | ✓ | — | — |
| `Arg` `L1` `L2` `Para` pills | ✓ | — | — |
| `Text` toggle | ✓ | — | — |
| `fit` / `auto` | ✓ | — | — |
| `READING` / `OUTLINE` chip | ✓ | — | — |
| `MODE` label + mode-name chip | — | ✓ | ✓ |
| `×` close | — | — | ✓ |
| `↑↓ SECTIONS` keynav readout | ✓ | ✓ | ✓ |
| comment-transport error | on failure | on failure | on failure |
| `toc/2` tree-version chip | ✓ | ✓ | ✓ |

Above it, the **masthead** — title, byline, source, sharing mark, word/part/section counts, the root
gist. It scrolls away (sticky on the horizontal axis only).

In Hierarchy there is also a **sticky `<thead>`** of column names — `Argument L0`, `Parts L1`,
`Sections L2`, `Text verbatim` — [`TableView.tsx`](../../src/web/TableView.tsx).

**So the sticky chrome is two rows in Hierarchy and one everywhere else**, and after the cuts below
it is one row in Hierarchy and none elsewhere.

**On a phone the bar is already stripped.** styles.css § a narrow window hides `.controls-label`,
`.keynav`, `fit`/`auto`, `reading`/`outline` and `.provenance`. What Greg is looking at is a
laptop-width problem, and the hide-on-scroll behaviour he wants kept is untouched by any of this.

**One defect the inventory found on the way**: at 390px the Hierarchy pill row overflows
horizontally and `Text` is clipped off the right-hand edge. Fixed in stage 3, where the row's
contents change anyway.

## Decisions

Product calls arbitrated by Fable, 2026-09-05, except where marked as Greg's.

1. **Everything Greg named goes**, plus the `Text` pill: the `MODE` and `GRANULARITY` labels, the
   mode-name chip, the `×`, the `↑↓` readout, the `toc/2` chip, `fit`/`auto`, the
   `READING`/`OUTLINE` chip and the `Spine` toggle.
2. **The `×` is not a loss.** The Dock's Plain button carries `keepLabel: true` precisely so that on
   a phone it is the one labelled word in the bar and it is the exit
   ([Dock.tsx](../../src/web/Dock.tsx), 2026-08-31). It already implements the same
   `plain`-not-`DEFAULT_MODE` contract the `×` argues for. Hierarchy never had a `×`.
3. **`?spine=` and `?text=` stay honoured; nothing in the UI writes them any more.** Deleting the
   parameters saves little — `fitView` still needs a three-state answer for the window's own
   decision — and it is a URL-contract change that collides with the `structure-mode` worktree,
   whose stage 3 already deletes `?cols=`. Recorded in url-state.md.
4. **"Always show the spine" keeps the window's veto.** The rail's default becomes on wherever the
   reader has not said otherwise, including `?text=0`, where it is off today. A window with no room
   still drops it: Greg's instruction is *the reader is never asked*, not *drawn at 390px*.
5. **The arc: drop the column, keep the artefact.** The `Arg` pill, the L0 column, the `hasArc`
   branches in `columnLabel`/`columnHint` and the arc rung in `navPlan` all go.
   [`src/arc.ts`](../../src/arc.ts), the `arc` job step and `arc.json` stay exactly as they are.
   Two reasons, and the first is decisive: **Outline mode renders the arc sentence for the current
   part as its rung 4** ([`OutlinePanel.tsx`](../../src/web/OutlinePanel.tsx) § `row.arc`), so
   "remove the functionality altogether" would take a feature out of a mode Greg did not mention.
   Second, [260903b](260903b-one-structure-mode-hierarchy-and-outline-merged.md) decision 7 says
   *"Argument v1 is the existing arc and nothing more"*, so deleting the stage is work that gets
   undone in weeks. Gating the pill behind the experimental switch was rejected: that switch is for
   *unfinished* features, and this is a finished one that should not be there — see
   [The simpler option passed over](#the-simpler-option-passed-over). An old `?cols=0,1,2` drops the
   `0` silently rather than breaking the link.
   Losing the L0 root-gist fallback costs nothing: granularity-zoom.md already records that "what
   the piece is" moved to the masthead.
6. **The `<thead>` goes, and the pills take over naming the columns** — `Parts`, `Sections`,
   `Paragraphs` instead of `L1`, `L2`, `Para`. The comment defending the numbers
   ([`tree.ts`](../../src/web/tree.ts) § `columnPill`) leans on *"both the column header and the
   tooltip say so"*; the header is going and a touch reader cannot open a tooltip, so both legs are
   gone and the argument inverts. `columnPill` collapses into `columnLabel`. The full words cost
   roughly 90px while the row sheds well over 300.
7. **← / → survive, and the aim gets a quieter indicator** — Greg's call, 2026-09-05. The readout was
   the only thing that could name an aim on the spine, and the lit `<th>` was the only thing that
   could name one on a column; both are going, so the aimed column is tinted instead. Mechanism in
   stage 3.
8. **The bar is not rendered when it would be empty** — Greg's call, 2026-09-05, choosing this over
   putting the article's title in it and over leaving a blank strip. In practice: Hierarchy always
   has it (the pills); every other mode has it only when the `ViewOnlyChip` or a comment-transport
   error needs a home. That keeps both of those where they are rather than moving them into the
   Dock, which is the follow-up if the inconsistency turns out to grate.

## Stages

Each ends with `npm test`, `npm run typecheck` and `npm run check` green, a browser pass at 1440×900
and 390×844, a GPT Sol review, and a commit.

### Stage 1 — empty the bar of what nobody needs

`.controls` loses the `MODE` and `GRANULARITY` labels, the mode-name chip, the `×`, the `↑↓`
readout, the `toc/2` chip, `fit`/`auto`, the `READING`/`OUTLINE` chip, the `Text` toggle and the
`Spine` toggle. `showSpine` defaults on. What is left: the `ViewOnlyChip`, the granularity pills and
the comment-transport error.

Files: `App.tsx`, `styles.css` (delete `.controls-label`, `.mode`, `.provenance`, `.keynav`,
`.linky`, `.mode-close`, and the narrow-window rules that hid them), `layout.ts` (the spine
default). Docs: `granularity-zoom.md` § What the bar calls each column, `keyboard.md`,
`url-state.md`, `reading-view-overview.md`.

**Done when** every mode's bar holds only pills (Hierarchy) or nothing (everything else), the rail
is on in `?text=0`, `?spine=0` still turns it off, and no stylesheet rule targets a deleted element.

**Landed 2026-09-05, `ec16ece9`.** Browser pass at 1440×900 and 390×844, signed in, 14 mode × width
combinations, no console errors. Three things it settled that were open:

- **An empty bar does not look broken.** It draws on the page's own background with a 1px bottom
  rule, and reads as a divider between the masthead and the article rather than as a gap. So stage 4
  is an improvement rather than a repair, and stage 1 was safe to push on its own.
- **The 390px pill-row overflow is already gone** — it was the deleted controls that were pushing
  `Text` off the right-hand edge, not the pills. `.controls` now measures
  `scrollWidth === clientWidth` at 390px.
- **The wordmark and the Feedback button do not move** when the bar's contents change — their rects
  are pixel-identical across all fourteen combinations. That is stage 4's trap narrowed: the risk is
  the *band* running under them, not the corners themselves shifting.

One thing it found that is **not ours and not in scope**: at 390px `document.body.scrollWidth` is
23–35px wider than the window in every mode except `?text=0`. The spine-on/spine-off delta is
exactly the rail's 12px, so it predates this work — a table minimum-width constraint at narrow
viewports.

There is also **a red arriving from `dev`**, `tests/doc-links.test.ts`: `summaries.md` cites
`types.ts` § `TreeNode.question`. Neither file is touched by this plan.

### Stage 2 — the arc leaves Hierarchy

Drop the `Arg` pill and L0 from the pill list and from `?cols=` fitting; drop `arcCells` from
`App`→`TableView`; drop the arc rung from `navPlan`; `columnLabel` and `columnHint` lose `hasArc`.
`useArc`, `buildArcColumn`, `outline.ts` rung 4 and the Metadata page's arc row are untouched.

Files: `App.tsx`, `TableView.tsx`, `tree.ts`, `keynav.ts`, `layout.ts`, `ContextPanel.tsx`,
`styles.css` § the arc, `tests/column-names.test.ts`, `tests/keynav.test.ts`. Docs:
`granularity-zoom.md` § the arc, `keyboard.md` § What each zone means.

**Done when** no `?cols=` value can open an L0 column, ← walks to Parts and stops, Outline mode's
rung 4 still shows the arc sentence, and the `arc` step still runs. (**Not** `npm run arc`, which
this plan named and which does not exist — that script and its six siblings were deleted; the stage
runs through `POST /api/jobs { steps: ["arc"] }`, `ingest-queue.md` § `npm run arc` is gone.)

**Landed 2026-09-05.** The removal is `layout.ts` § `offerableGists` — one exported rule, applied by
the two callers that need it for different reasons: `fitView`, which still takes the article's full
depth range, and the pill row in `App.tsx`, which offers exactly what the fit can open. `?cols=0,1,2`
therefore drops the `0` in silence and opens 1 and 2, which is pinned in `tests/layout.test.ts`.
Both behaviour changes were red first.

Three things it settled beyond the brief:

- **`ContextItem.text` and `step` went too.** I had kept them as tombstoned dead code on the
  argument that [260903b](260903b-one-structure-mode-hierarchy-and-outline-merged.md) decision 7's
  Argument mode would want them back. Sol's counter is decisive and I took it: that decision
  describes a **band** carrying part titles, gists and section doors — not this fisheye column — so
  the implementation buys nothing. `Step`, `STEP_LANDMARK_PX`, `crumbFor`'s `"The argument"`,
  `.ctx-step` / `.tip-step` and `ContextPanel`'s now-redundant `navDepth` prop went with them.
- **A real regression this stage widened**, found by Sol and not by me: `?cols=0,3` now resolves to
  `[3]`, and a leaf-only column set passed `panels` while yielding no levels — so `useColumnContext`
  measured every row on every scroll to place entries in a list of nothing. `?cols=3` already
  reached it; stage 2 opened a second door. The panels now mount on `panels && depths.length > 0`,
  and swipe is untouched.
- **`docs/project/browser-testing.md`'s column cases were exercising Plain**, because `DEFAULT_MODE`
  is `plain` — so a browser pass following that text could not have seen a stage-2 regression at
  all. Every case now says `?mode=hierarchy`. Worth knowing before stage 3's pass.

### Stage 3 — the column-header row loses its height, not its element

**Rewritten 2026-09-05 after GPT Sol refused the first version.** The plan was to delete the
`<thead>`. That would have emptied the Parts and Sections columns completely: `useColumnContext`
derives every column's rectangle from `thead th[data-col]`
([`useColumnContext.ts:107`](../../src/web/useColumnContext.ts)), `ContextPanel` returns `null`
without one, and the gist cell underneath **deliberately draws only its boundary while panels are
enabled** ([`TableView.tsx:1033`](../../src/web/TableView.tsx)) — which is unconditional
(`enabled: true`, line 1320). So Hierarchy's columns would have become empty boxes. Verified
against the code, not reasoned.

**So the row keeps its element and gives up its height.** `thead th` collapses to `height: 0`,
no padding, no border, with the label text visually hidden but still in the accessibility tree.
That is what Greg asked for — the vertical space — and it costs none of the four jobs the element
is quietly doing:

| What the `<thead>` is for | After |
|---|---|
| The visible column names | gone; the pills in the bar take over, renamed to full words |
| Column geometry for the fisheye panels | unchanged — `<colgroup>` and `table-layout: fixed` fix the widths, so `left`/`width` are still right, and `bottom` now correctly puts the panels directly under the bar |
| `stickyOffset()`'s second term | measures zero, so a jump clears the bar and nothing else — which is the truth |
| `<th scope="col">` naming cells for a screen reader | unchanged; the pills are outside the table and can never do this job |

Also in this stage:

- **`stickyOffset()` stops querying `thead` at all.** An article's *own* prose can contain a
  `<table><thead><th>`, and it survives sanitising — checked here by running
  [`src/sanitize.ts`](../../src/sanitize.ts) over one, not by reading the allowlist. So the global
  `document.querySelector("thead th")` can match article content.
  **It is latent rather than live, in both directions**: our head is inside `table.zoom` whose
  `<tbody>` holds the prose, so ours is always first in document order — before this change *and*
  after it, since the head keeps existing. What makes the query pointless is that a zero-height head
  contributes zero. So the change is a simplification with a safety margin, not a repair: measure
  `.controls` only, floored at `safeAreaInsets().top` (there is a fixed opaque `.reader::before` of
  exactly that height, `styles.css:396`), and **`safeTop`, not `0`, when there is no bar**.
  Regression test with an ordinary article `<thead>` present as a decoy.
- **`columnPill` collapses into `columnLabel`** — `Parts`, `Sections`, `Paragraphs`.
- **The aim indicator** moves from `th.nav-aim` to a `data-aim` attribute on the `<table>` — no
  per-cell class, so `memo(TableView)` is unaffected. It must be a **later `background-image:
  linear-gradient`, not a `box-shadow`**: `.pin-left` already owns `box-shadow` for the
  overflow-layer cue (`styles.css:890`) and a second one replaces rather than composes with it. The
  selector matrix has to cover every gist depth **and the prose cell, which carries no `depth-N`
  class** (`TableView.tsx:1127`), and the spine.
- **`.only-prose` is not deleted** — only `table.only-prose thead` is. A second rule uses the same
  class to align the masthead with centred prose, pinned by
  `tests/prose-centred-in-its-cell.test.ts:123`.
- **`?text=0` gets normalised away at boot** rather than left as a state with no exit. The `Text`
  pill was the only way back to the prose, so an old `?mode=hierarchy&text=0` link would strand the
  reader. `main.tsx` already rewrites two superseded spellings of the metadata panel; this is a
  third rewrite in the same place, to `?mode=outline` — which is what that link was asking for and
  is the mode built to answer it. The parameter machinery stays for the `structure-mode` worktree
  to delete.

Files: `TableView.tsx`, `tree.ts`, `scroll.ts`, `main.tsx`, `styles.css`,
`tests/mobile-chrome.test.ts`, `tests/column-names.test.ts`, `tests/url-state.test.ts`. Docs:
`granularity-zoom.md`, `keyboard.md`, `design-css-overview.md`, `url-state.md`.

**Done when** Hierarchy has one visible sticky row, the fisheye panels still draw their contents, a
deep link lands with the target's top clear of the bar with an article-owned `<thead>` on the page,
and pressing ← / → visibly moves the aim including onto the prose.

### Stage 4 — the bar disappears when it has nothing in it

Render `.controls` only when it has content.

**`--bar-h` does not move**, and the first draft of this stage said it should. It is not a presence
token: it also sizes `.logo-home` (`styles.css:3702`) and `.fb-button` (`styles.css:13904`), both
fixed corner elements outside the reader, so zeroing it collapses two hit areas to nothing. Only
**`--bar-bottom` falls to `var(--safe-top)`** under a bar-less reader; `--bar-hide` is the mobile
transform token and needs no absent state. GPT Sol, 2026-09-05.

`stickyOffset()` with no bar returns `safeAreaInsets().top`, not `0` — stage 3 already puts it
there.

**The known trap**: both fixed corner elements — the wordmark *and* the Feedback button — reserve
their space through the bars' own padding
([`FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx) § The bars have to reserve the space), so
with no bar a `position: fixed` band at `--safe-top` runs under both. Clear or reserve **both**, not
only the logo. Browser pass at 820px, which is where `PublicChrome` measured the same collision.

Files: `App.tsx`, `styles.css`, `scroll.ts`, `layout.ts`. Docs: `web-client.md`,
`reading-view-overview.md`, `design-css-overview.md`.

**Done when** Plain, Summary, Chat and Glossary show no bar for an owner, a visitor still sees the
read-only chip, and nothing on the page is positioned as though a bar were there.

## The reviews

**Round 1, on the plan** — [`…-plan-review-sol.md`](260905d-declutter-top-bars-plan-review-sol.md),
GPT Sol, 2026-09-05. **Refused**, six established P1s and no P0s. Dispositions:

| | Finding | Disposition |
|---|---|---|
| F1 | Removing `<thead>` empties every fisheye panel | **Accepted, and it rewrote stage 3.** Verified in the code. |
| F2 | `stickyOffset()` can match an *article's own* `<thead>` | **Accepted.** Pre-existing; closed in stage 3. |
| F3 | "`0` when neither" is wrong with a safe-area inset — there is a fixed `.reader::before` of exactly that height | **Accepted.** `safeTop`, not `0`. |
| F4 | Stage 1 deleted `.mode`, which `ViewOnlyChip` still uses | **Already avoided.** The implementing agent grepped and kept it. |
| F5 | Deleting the head removes the table's accessible column names | **Accepted**, and the zero-height head keeps them without the visually-hidden `<thead>` + `headers` IDs Sol proposed. |
| F6 | `?text=0` becomes a state with no way out | **Accepted, different fix.** Sol wanted a conditional recovery pill; a boot-time rewrite to `?mode=outline` is fewer parts and `main.tsx` already does two of these. |
| F7 | `--bar-h` is not a presence token — it sizes both fixed corners | **Accepted.** Stage 4 moves only `--bar-bottom`. |
| F8 | The aim rule misses the prose cell and clobbers `.pin-left`'s shadow | **Accepted.** Gradient, not `box-shadow`; matrix specified. |
| F9 | `.only-prose` has a second consumer with a test behind it | **Accepted.** Only `table.only-prose thead` goes. |
| F10 | This does not stay out of `structure-mode`'s way | **Accepted as a fact, not as a stop.** See below. |

**On F10 and sequencing.** Sol is right that the overlap is semantic and not just textual: both
plans touch `App.tsx`, `layout.ts`, `keynav.ts`, `styles.css`, column naming, the navigation rungs
and the meaning of `?text=0`. It asks that the two not run concurrently. **Overruled**, because they
already are and Greg asked for this now: `structure-mode` is mid-stage-1 and Structure is an
*addition* behind the experimental switch, so nothing here removes anything it depends on.
The rule instead is **whoever lands second merges `dev` and adapts** — and this plan states its new
contracts explicitly (the rail's default, `stickyOffset`'s selector, `?text=0`'s rewrite, the
zero-height head) so there is something to adapt *to*. Merge `dev` between every stage.

**Round 2, on stage 2's code** — [`…-stage2-review-sol.md`](260905d-declutter-top-bars-stage2-review-sol.md),
GPT Sol, 2026-09-05. **Accept with changes**, seven findings, no P0 or P1: one reachable performance
regression, one over-retained tombstone, and five documentation and comment defects. All seven were
accepted and fixed; the dispositions table is in that file. The two that changed the code rather
than the prose are recorded under stage 2 above.

## What this deliberately does not do

- **It does not build Argument mode.** That is stage 4 of
  [260903b](260903b-one-structure-mode-hierarchy-and-outline-merged.md), in the `structure-mode`
  worktree, whose stage 1 changes how a band negotiates width — a mode built now against today's
  band would be rebuilt.
- **It does not delete `?cols=`, `?spine=` or `?text=`.** Same worktree, same reason.
- **It does not move the `ViewOnlyChip` or the comment-transport error into the Dock.** Fable
  recommends both; they are a second argument, and stage 4 keeps them working where they are.

## The simpler option passed over

Hiding these controls behind the experimental-features switch rather than deleting them. Rejected:
the switch is for features that are *unfinished*, and none of these is — they are finished things
that should not be there. Hiding them would leave the bar exactly as confusing for anybody who
turned the switch on, and would grow the switch into the general preferences system
[experimental-features.md](../project/experimental-features.md) says it is not.

## Baseline

`npm test` on this worktree at `d0bdb31c`, 2026-09-05: **687 files pass, 4 fail, 1 skipped**, all
four pre-existing and none of them ours — `admin-store` (two, Postgres contention),
`cold-start-lazy-imports` and `pdf-bundle-trace` (both need a build to inspect),
`hierarchy-deepen-wave`.

## See also

- [reading-view-overview.md](../project/reading-view-overview.md)
- [granularity-zoom.md § What the bar calls each column](../project/granularity-zoom.md#what-the-bar-calls-each-column)
- [keyboard.md](../project/keyboard.md) — what the `↑↓` readout was for
- [260903b](260903b-one-structure-mode-hierarchy-and-outline-merged.md) — the in-flight Structure
  mode, which may replace Hierarchy's presentation entirely
