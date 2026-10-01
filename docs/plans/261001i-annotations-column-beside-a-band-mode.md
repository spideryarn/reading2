# Annotations' column beside a band mode

A follow-up deferred by [261001d](261001d-annotations-mode-marginalia-in-a-right-hand-column.md)
§ Deferred, named, for the reports in
[260930_2311](../user-feedback/260930_2311-annotations-mode-marginalia-in-a-right-hand-column.md)
(`spya-u3dgk7`, `spya-w2kgha`). Greg, 7K:

> This raises lots of questions about whether both left- and right-hand columns can be visible at the
> same time (ideally yes, if the window is wide enough, otherwise probably only one or the other), etc
> etc.
>
> For now, let's say that Annotations mode is the only one that can appear in this right-hand-column,
> though we'll see in future.

## What the reader gets

```
 wide enough (≥ 900px with the rail):
 spine │ band (Glossary, Chat, …) │   prose   │ notes │
                                    ^ capped at Plain's measure; spare room goes right of the notes

 700–899px:                         ≥ 700 is where a band still fits beside the prose
 spine │ band │      prose       │       ← the band wins; one line at the foot says the notes
                                          need a wider window or the band closed

 under 700px (a phone):
 band over everything                     ← the band wins, as it does today; no line over it
```

- **Two switches, not one.** The left band is the mode (`?mode=`), exactly as now. The right
  column is its own switch, **`?margin=1`**, independent of the mode. Pressing Glossary while the
  notes are showing opens Glossary and keeps the notes; pressing Plain closes the band and keeps the
  notes; pressing Annotations turns the notes on or off and leaves the band alone.
- **The Dock's Annotations button becomes a toggle** (`aria-pressed`), drawn just after the mode
  radiogroup rather than inside it — a radiogroup has exactly one checked member, and the notes are
  not one of the things the middle band can show. So it moves from beside Summary to the
  right-hand end of the modes, a run of its own, which is also where its column is. Same icon,
  same experimental switch, and it stays drawn while pressed with the switch off.
- **Narrow windows: the band wins.** It is what the reader opened most recently and most
  specifically, and it is interactive (a half-typed question, a quiz answer); the notes are ambient.
  Below 700px the band already covers the prose, so notes would annotate text nobody can see. The
  `?margin=1` stays in the address, so widening the window or pressing Plain brings them back with
  no further state. Between 700 and 899px the existing "needs a wider window" line says so, worded
  for the case, centred under the prose rather than the window; under a covering band it is not
  drawn, nor once that band has stepped aside (its back pill is there instead).
- **Old links**: `?mode=annotations` (one day old, behind the experimental switch) opens as Plain
  with the notes on — one `replace` on arrival rewrites it to `?margin=1`. The server's `readMode`
  reads it as Plain.

## The decision, and the simpler option passed over

Two state models were weighed (Opus arbitrated, 2026-10-01):

- **(A, taken) two independent axes**: `mode` names only the left band; `margin` names the column.
  Every parameter already survives a mode switch (url-state.md), so the column carries across band
  changes for free, and there are no illegal pairs.
- **(B, passed over) Annotations stays a mode**, with `?notes=1` meaning "and the column beside band
  X". Less change in the Dock, but "the column is showing" is then stored two ways
  (`mode=annotations`, and `notes=1` beside another mode), with duplicate and illegal states to
  police and three hand-written carry-over rules (a band press carries it, an Annotations press
  toggles it, Plain clears it).

The name is `margin`, not `notes`: `note` is already the explanation dialog's parameter and one
letter away.

This is a product call made on Greg's "ideally yes"; the Overseer has been told, with the
recommendation, and the work carries on.

## The types

`annotations` stays in `MODES`, the catalog, activation and the experimental gating — they key the
Dock button, the command bar and the catalog card. What changes is the *state*:

- `export type BandMode = Exclude<Mode, "annotations">` in src/modes.ts.
- `modeParam` parses to `BandMode` (`annotations` → `null`, i.e. Plain); `readMode` likewise.
- `Reader`'s `mode` and `setMode` are `BandMode`, so the Dock's `onMode(next: Mode)` does not
  compile until it branches: `annotations` toggles `margin`, everything else sets the mode. The
  `"annotations"` arm of `modeBand()` goes; the head and the owner's ideas feed move to their own
  boundary, drawn when the column is on.
- `bandOpen` becomes `mode !== "plain"`; `marginOpen` becomes the `margin` param.

## The layout

`fitView({ modeBand, margin })` stops ignoring `margin` when a band is open — that comment was the
deferral. New branch `fitBoth`:

```
avail   = window − spine
margW   = clamp(avail − MODE_MIN − PROSE_MIN, MARG_MIN, MARG_IDEAL)
rest    = avail − margW                         // what band and prose share
if bandCoversProse-at(rest)  → fitMode(window) unchanged, margW 0   (the band wins)
modeW   = bandWidth(rest, shape)               // Structure's columns and Tweets' share as usual
proseW  = min(proseAloneMaxPx, rest − modeW)   // capped, so the notes sit beside the text
margReserve = avail − modeW − proseW           // ≥ margW: the column plus any spare room
margLeft    = spine + modeW + proseW
```

The column appears at `avail ≥ MODE_MIN + MODE_PROSE_FLOOR + MARG_MIN` = 888 (900px with the rail).
The column shrinks first, then the band, then the prose, the same order the existing functions use.

**The prose is capped at Plain's width when the column is beside it**, unlike a band alone, where
the cell takes the whole rest and the prose centres inside it. A note sits at the cell's right edge
(`left: 100%` of `td.text`), so an uncapped cell at 2560px would put the notes 500px from their
paragraph. The cost: toggling the notes on a wide window moves the prose left by up to half the
spare room. Recorded rather than solved — centring the pair would mean a second left offset beside
`--mode-w`, which five rules read.

**The masthead**: `.reader:has(table.only-prose):not(.text-alone) .masthead-inner` aligns the title
over the prose by assuming the bar and the reading cell are the same box. With a reserve they are
not, so its `100%` becomes `100% - var(--marg-reserve)` — inert (0) everywhere else.

Structure's face reads the band width it was given (`structureFace`), so with the notes on its
columns appear at a wider window than without; the face and the band cannot disagree.

## GPT Sol's plan review, and what changed

[261001i-annotations-beside-a-band-plan-review-sol.md](261001i-annotations-beside-a-band-plan-review-sol.md),
on [its prompt](261001i-annotations-beside-a-band-plan-review-prompt.md); verdict *build with
fixes*, and it checked the `fitBoth` arithmetic as sound (threshold, cap, `minWidth`, insets,
Structure's face, Tweets' band).

| | Finding | Taken? |
|---|---|---|
| P1 | `margin` missing from last-view, so `?margin=1` would read as a bare address and get a remembered band replayed over it; an old stored `?mode=annotations` would restore after the arrival rewrite | **Yes.** `margin` is in `REMEMBERED`; `rememberableSearch` translates `mode=annotations` to `margin=1` on the way in and out, so a restore never carries the old word. Tests seen red. |
| P1 | the Dock has two axes: `visibleModes` must keep a pressed toggle behind the switch; the command bar must still list it; `fitSignature` must know it; the metadata page's link must not mint `mode=annotations` | **Yes**, all four. Annotations moved to the end of `MODES_UI`, a run of its own, so the bar and the command bar list it in the same place without a special case. |
| P1 | "the band wins" is undefined once a band has stepped aside on a phone (`bandAway`) | **Decided: the band still wins**, and no line. Re-fitting to notes-only while the band is away would rewrap the prose under the passage the reader just jumped to, and rewrap it back when the band returns. The line was first drawn while the band was away; the browser check found the band's back pill sitting on top of it, so it is hidden wherever a band covers the window, away or not — the pill is the way on. |
| P2 | `BandMode` should reach every read-state seam, not only Reader | **Yes**: `selectPassages`, `pageTitle`, `readMode`, the conversation bands' `onMode`; `BAND_MODES` for the tests that loop over modes. |
| P2 | the narrow line must be centred under the prose, not the window | Already in the build when the review ran (`marginalia.css`); checked in the browser. |

## Tests, red first

- `tests/layout-margin.test.ts`, swept 300–3290px × both rails × roots 12/16/20 × three band shapes:
  never runs off the window; `margLeft` is the table's right edge; prose ≥ `MODE_PROSE_FLOOR` and
  ≤ the cap; the band is exactly `fitMode`'s answer for `rest`; below the threshold the fit equals
  `fitView({ modeBand })`; the crossover is 900 with the rail. The old "ignored when a band is
  open" test is inverted.
- `modeParam` / `readMode`: `annotations` → Plain; a `margin` parser for `1`/`0`/junk.
- The Dock: Annotations is an `aria-pressed` toggle outside the radiogroup, pressed from `margin`,
  still behind the experimental switch (and kept drawn while pressed, as `visibleModes` keeps the
  current mode).
- A Reader-level test: `?mode=glossary&margin=1` at 1600 draws the band and the notes; at 800 the
  band and the line; at 390 the band and no line; `?mode=annotations` rewrites to `?margin=1`.
- The surface tests that opened `?mode=annotations` move to `?margin=1`.

## Stages

1. Types, params, layout, Reader, Dock, CSS, tests. One stage: the pieces do not stand alone.
2. Browser check (Sonnet, Playwright on the box): 1600, 1100, 900, 800, 390; Glossary, Structure,
   Tweets with the notes; toggling; old link. Then GPT Sol's code review (write-capable).
3. Docs: url-state.md's table, reading-view-overview.md, narrow-windows.md, the 261001d plan's
   deferred line, the feedback note.

**Done when** the five widths look right in screenshots I have read, the gates are green, and Sol's
review is in.

## The browser check

A Sonnet subagent drove the build in Playwright on the box (article `hwh-spya-ara60g`, 10 notes) and
measured. Screenshots: [261001i-shots/](261001i-shots/).

| Width | Band | Band right | Prose | Notes left | Column |
|---|---|---|---|---|---|
| 1600 | Glossary, Summary | 412 | 412–1220 | 1220 | 288 |
| 1600 | Structure (columns) | 717 | 717–1312 | 1312 | 288 |
| 1600 | Tweets | 556 | 556–1312 | 1312 | 288 |
| 1100 | Glossary | 300 | 300–844 | 844 | 256 |
| 900 | Glossary | 300 | 300–700 | 700 | 200 |
| 899, 800 | Glossary | 355, 300 | to the edge | — | line, centred under the prose (627 / 550, both exact) |
| 390 | Glossary | covers | — | — | no line |

No horizontal overflow at any width, no overlapping notes, no page errors. The Dock toggle turned
the notes on and off with the band left alone, Plain closed the band and kept the notes, and
`?mode=annotations` rewrote itself to `?margin=1`. The title sits 80px left of the first line in
Glossary at 1600 — the same 80px it sits without the notes, the prose's own gutter, so not this
change. **One flaw, fixed**: on a phone, with the band stepped aside after a term was opened, the
band's back pill lay over the left half of the "needs a wider window" line; the line is no longer
drawn under a band that covers the window, away or not.
