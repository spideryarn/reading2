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

### Stage 2 — the arc leaves Hierarchy

Drop the `Arg` pill and L0 from the pill list and from `?cols=` fitting; drop `arcCells` from
`App`→`TableView`; drop the arc rung from `navPlan`; `columnLabel` and `columnHint` lose `hasArc`.
`useArc`, `buildArcColumn`, `outline.ts` rung 4 and the Metadata page's arc row are untouched.

Files: `App.tsx`, `TableView.tsx`, `tree.ts`, `keynav.ts`, `layout.ts`, `ContextPanel.tsx`,
`styles.css` § the arc, `tests/column-names.test.ts`, `tests/keynav.test.ts`. Docs:
`granularity-zoom.md` § the arc, `keyboard.md` § What each zone means.

**Done when** no `?cols=` value can open an L0 column, ← walks to Parts and stops, Outline mode's
rung 4 still shows the arc sentence, and `npm run arc` still works.

### Stage 3 — the column-header row goes, and the pills take its job

**The failing test comes first.** `stickyOffset()` ([`scroll.ts:77`](../../src/web/scroll.ts))
returns `0` when there is no `thead th`, so removing the head would land every deep link, every
`?at=` reading and every arrow-key step *underneath* the controls bar — with nothing reporting an
error, which is [silent-success.md](../reusable/silent-success.md) exactly. It must measure the bar
alone when there is no head, the head alone when there is no bar, and `0` only when there is
neither; `tests/mobile-chrome.test.ts` already holds the last of those and gains the first two.

Then: remove the `<thead>`; `columnPill` collapses into `columnLabel`; the aim indicator moves from
`th.nav-aim` to a `data-aim` attribute on the table, with four static rules tinting the aimed
column's cells — no per-cell class, so `memo(TableView)` is unaffected and the aim can still be the
prose column or the spine. Fix the 390px overflow of the pill row.

Files: `TableView.tsx`, `tree.ts`, `scroll.ts`, `styles.css` (`thead th`, `.depth-tag`,
`th.text .th-measure`, `--head-h`, `.only-prose`), `tests/mobile-chrome.test.ts`,
`tests/column-names.test.ts`. Docs: `granularity-zoom.md`, `keyboard.md`, `design-css-overview.md`.

**Done when** Hierarchy has one sticky row, a deep link lands with the target's top clear of the
bar, and pressing ← / → visibly moves the aim.

### Stage 4 — the bar disappears when it has nothing in it

Render `.controls` only when it has content. `--bar-h` and `--bar-bottom` must fall to `0` (plus
`--safe-top`) when it is absent, or the band, the spine, the fade and the sticky table head are all
positioned against a bar that is not there. `stickyOffset()` with no bar and no head must stay `0`.

**The known trap**: the fixed corner wordmark and the Feedback button reserve their space through
the bars' own padding
([`FeedbackButton.tsx`](../../src/web/FeedbackButton.tsx) § The bars have to reserve the space), so
with no bar a `position: fixed` band at `--safe-top` sits under the 136×44 logo. Check
`HomeLogo.tsx` and either inset the band or move the logo; browser pass at 820px, which is where
`PublicChrome` measured the same collision.

Files: `App.tsx`, `styles.css`, `scroll.ts`, `layout.ts`. Docs: `web-client.md`,
`reading-view-overview.md`, `design-css-overview.md`.

**Done when** Plain, Summary, Chat and Glossary show no bar for an owner, a visitor still sees the
read-only chip, and nothing on the page is positioned as though a bar were there.

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
