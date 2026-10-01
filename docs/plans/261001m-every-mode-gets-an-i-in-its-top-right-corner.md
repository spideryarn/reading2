# Every mode gets an (i) in its top-right corner

Feedback SPIDERYARN-READING2-8H, report `spya-ucu35y`, Greg, 2026-10-01:

> In Tweet-thread mode, it says "Written by claude-sonnet-5 · tweets/5 · 1 Oct 2026 · 20.0s" at the
> bottom.
>
> Move this into a tooltip for a (i) icon in the top-right. see tooltips.md
>
> And then update any other modes to move out similar such explanatory/output/metadata text (unless
> it's really valuable) to follow this (i) approach, and update new-mode.md and design docs
> accordingly.
>
> And perhaps rename new-mode.md -> mode.md (along with any references).
>
> Each mode should have such an (i) icon, which contains information like:
> - how many X (of y)
> - other useful explanatory information about what this is, why, how it works, caveats, how to
>   understand it, etc
> - when it was generated/ran
> - what model was used
> - etc etc as per mode as you see fit

## What exists already

- `src/web/BandAbout.tsx` (plan 261001l): an `(i)` button with a controlled `Tooltip` — hover,
  focus and tap all open it. FAQ and Citations use it, placed by each mode at the end of its
  order row.
- Three hand-rolled (i)s: Trajectory's `.traj-about`, Diagram's `ScatterNote` (`.diag-about`), and
  Referee's *how this works* button, which opens a large card **inside the band** rather than a
  tooltip.
- `ModeSurface` renders every mode's `<aside class="mode-band">`: `head` in a `.band-head`, then the
  children, then `foot`, and **no other DOM**. `.mode-band` is `position: fixed`, so it is already
  the containing block for an absolutely placed child. An inventory on 2026-10-01 found no CSS that
  depends on the position of the band's direct children (`:first-child`, `+`, and so on); the
  only order-sensitive thing is Search's zero-slack flex fit, which an out-of-flow child does not
  touch.
- A visitor's artefacts (`src/public-types.ts`) carry no `generator`, `generatedAt` or
  `elapsedMs`. Provenance can only ever be shown to the owner, which is fine: a visitor's (i) holds
  the explanation and the counts.

## The design

**One slot, one place.** `ModeSurface` takes `about?: ReactNode`. When it is set, the band gets a
`BandAbout` **absolutely positioned in its top-right corner** — the first child in DOM order, so
it comes first in tab order, but out of flow, so it moves nothing. The band also gets
`has-about`, which sets `--band-about-room` (the button's width plus a gap), and the band's top row
reserves that much padding on its right so the icon never sits on top of a control. `.band-head`
does this in `mode-band.css`; a mode whose top row is its own (a sort row, a controls row) adds
the same `var(--band-about-room, 0px)` to that row's right padding in its own stylesheet.

```
┌ mode-band ──────────────────────────────── (i) ┐  ← ModeSurface's, every mode the same
│ 12 posts  [copy]                               │  ← the mode's top row, padded clear of it
│ …                                              │
```

**One shape for "how it was made".** `AboutMade` (in `BandAbout.tsx`) takes the artefact's
`generator`, `version`, `generatedAt` and `elapsedMs`, any of which may be absent (a visitor, or a
mode with no model), and renders, for example:

> Written by claude-sonnet-5 (tweets/5), 1 Oct 2026, 14:03 (3 hours ago), in 20.0s.

The date follows design-css-overview.md § Dates: the exact time and the "ago" form, both
(`exactly` and `relativeAgo` in `relative-time.ts`; past 30 days, the exact form only). `relativeAgo`
reads `Date.now()` when the card renders, and `Tooltip` renders its content only while open, so
the "ago" is right whenever somebody reads it.

**What each mode's card holds**, in this order: what this is and how to read it — **the mode's own
`MODE_CATALOG` `description` and `how`**, the words the Dock's card on its button already says,
so the two cannot drift (Sol P2). `ModeSurface` takes `mode` and draws those itself, so a band
given its mode has its (i) in every state, empty and visitor included; `about` adds the rest: counts ("12 posts, 1 over the 280-character
limit"); caveats; then `AboutMade`. A mode with no model and no stored run says nothing about
provenance rather than "Written by unknown".

### What moves into the card, mode by mode

Counts and explanatory lines move. **What stays in the band**: empty states, running jobs,
failures, stale notices, and any count that sits beside the control it describes (Glossary's and
Quotes' `visible of total` by the threshold slider, Quiz's *Question 3 of 8*, which is navigation).
A head whose only content was the count goes away entirely, which gives the space back.

| Mode | Moves into the (i) | Stays |
| --- | --- | --- |
| Tweets | the *Written by* foot line; the head's posts/characters/words count; the over-limit sentence | copy button, profile badge, the run row and its failure |
| Summary | how the Parts outline is made; for the plain-words sub-mode, the run's provenance | the controls row and its tooltips |
| Glossary | term count, passes, provenance | sort row and its threshold count; Find more |
| Ideas | idea count, provenance | the per-group sentence under each heading (it labels the group — content) |
| Quotes | count, the discarded note, provenance | rank row, threshold count, Find more |
| Timeline | event count, provenance | the "everything dated here is in {year}" line (the rows omit the year because of it) and the "not really a story in time" note — Sol P1; the no-chronology empty state |
| Citations | its existing `BandAbout` contents, moved from the order row; count; provenance | — |
| FAQ | its existing `BandAbout` contents, moved from the order row; the question count (Sol P2); provenance | — |
| Trajectory | `.traj-about`'s contents, moved to the slot; provenance | the stop readout |
| Debate | count line, *Searched on …*, the foot's count lines, the extracts-only sentence, provenance | the order sentence (it must be read before the list — Sol P2), the heading, failure lines |
| Quiz | provenance, how many were dropped | *Question n of m*, the not-yet-read note (it changes what you can do) |
| Diagram | `ScatterNote`'s card; the ready-state "N dotted links from M passages · model" line | loading and error lines |
| Structure, Outline | a sentence on where the tree comes from | the per-part paragraph total |
| Search | a sentence on how search works and that searches are kept | every hint and count (they are live status) |
| Chat, Remember | a sentence on what the mode does and that answers cite passages | — |
| Referee | **nothing**: its *how this works* card is too long for a tooltip and is already the mode's (i). Named as the one exception in mode.md. | everything |

**A guard.** `tests/every-mode-draws-its-surface.test.tsx` phase B already renders every owner's
populated band. It gains one assertion: every `kind: "band"` row has exactly one `.band-about` in
its band, apart from a named Referee exemption. That turns "each mode should have" into something a
sixteenth mode cannot skip.

**Revised after GPT Sol's plan review** (`261001m-mode-info-plan-review-sol.md`, verdict "revise,
then build"): Timeline's two caveats stay; Debate's order sentence stays; FAQ gains its count; the
catalog copy is reused; the (i) sits at `z-index: 3`, above sticky rows inside a band; Outline's
inset goes on `--outln-pad-r` so its measuring copies match; and the guard also runs in phase A
(the empty and running states) and checks the (i) is the band's first child. Referee stays exempt
— its card is long and opens inside the band — and that is named to Greg as a product exception
rather than decided silently. The rename's damage to quotations is below.

### The rename

`docs/project/new-mode.md` → `docs/project/mode.md`, with `git mv`, following rename-or-move.md:
every live reference in `docs/project/`, `AGENTS.md`, `src/` comments and `tests/` comments. Dated
records (plans, postmortems, research, user-feedback) are links too, and `tests/doc-links.test.ts`
checks them, so they get the path change and nothing else. **Except quotations and recorded
diffs**: the first pass rewrote Greg's quoted *"make a note in the new-mode.md (or similar)"* and two
review `.diff` files; those 17 lines went back to the old name (Sol P1).

### The docs

- mode.md § *No description line in the band*: extended into the rule — every band has an (i) via
  `ModeSurface`'s `about`, what goes in it and in what order, and what stays in the band.
- tooltips.md: `BandAbout` and the corner slot, with the Referee exception.
- design-css-overview.md: `--band-about-room`, and how a mode's own top row clears the corner.

## The simpler options passed over

- **Keep placing `BandAbout` per mode in each mode's own top row**, as FAQ and Citations do. Less
  CSS, but sixteen modes would each choose a spot, and "every mode has one" would be checked by
  nothing. Greg asked for top-right, the same everywhere.
- **Put the (i) inside `.band-head` and give every band a head.** Modes with no head (Summary,
  Search, Structure, Outline, FAQ) would grow a whole row to hold one icon — the wasted space the
  report is about.
- **Only Tweets.** That is the report's first sentence, but the rest of it asks for every mode.

## Stages

1. **The slot.** `ModeSurface.about`, the corner CSS, `AboutMade`; Tweets, Citations and FAQ moved
   onto it; the guard test written red-first, with every other mode listed as pending so that it
   is red for the right reason; the rename; the docs.
2. **The other modes**, a small edit each, in a few subagent batches split by file.
3. **Check**: `npm test`, `npm run typecheck`, lint on touched files, a GPT Sol code review, a
   Playwright pass at desktop and phone widths over several modes (corner placement, overlap with
   the top row, tap to open), then push to `dev` and write the feedback note.

## Risks

- **The corner overlapping a mode's top row.** That is what `--band-about-room` is for; checked in
  the browser, mode by mode.
- **`mode-surface-changes-no-markup.test.tsx`** pins Search's and Chat's markup to a recorded
  shape. Both will gain the button; the expected markup is updated on purpose, and the commit says
  why.
- **Many mode sessions are queued.** Merge `origin/dev` often; keep each per-mode edit small.

## What landed (stages 1 and 2)

- `ModeSurface` takes `mode` and `about`; `BandAbout.tsx` gained `AboutMode` (the catalog's two
  paragraphs) and `AboutMade`. Every mode band but Referee passes `mode`, so its (i) is there in
  every state. The guard in `every-mode-draws-its-surface` checks it in phase A (empty or running)
  and phase B (populated), first child, and no "Written by" on any band.
- **Counts left every head and order row** (Glossary, Quotes, Ideas, Timeline, Citations, Debate,
  Tweets) for the card; threshold "n of m" and Quiz's "Question n of m" stay. Citations was brought
  into line with Glossary and Quotes after the batches came back.
- **Empty head rows kept** where the head was a fragment held so the row stays put while the list
  loads (Timeline, and Citations with no order row): dropping them would put the (i) over whichever
  first row happens to be drawn. To be checked in the browser.
- **Quiz** does not pass `mode`: Remember's catalog `how` is about Recall. Its card opens with
  `REMEMBER_SUB_MODES.quiz.description` instead.
- **Diagram** lost `ScatterNote` and its head row; the caveat and the dotted-links count are in the
  card when a projected picture is ready, and the `role="status"` region still speaks them.
- **Trajectory** lost `.traj-about`; its promise and coverage note are in the card.
- **Debate**: the count, *Searched …*, the foot's count lines (a visitor's withheld line included)
  and the extracts-only sentence are in the card; the order sentence and the `<h2>` stay.
- **Outline**'s inset is on `--outln-pad-r`, which narrows every row by ~1.9rem, not only the top
  one, because its measuring copies must match what is drawn.
- Known gaps, for the browser pass: a visitor's Diagram has no picker row, so the (i) sits over
  the picture's corner; Structure's "You are between parts." line has no clearance.
