# 260928a — Structure's two columns: a later switch, wider columns, one look

Greg's request, 2026-09-28, and the whole brief:

> I like the way the Structure Mode works with choosing 1- and 2-column mode based on the width of
> the browser. The 1-column mode is fine. But the 2-column mode is a little hard to read because the
> text is small the columns are really narrow. Perhaps we only switch to 2-column mode when the
> window is a little wider, and provide more space for the 2 columns, etc. And also make the visuals
> a bit more consistent (e.g. colours, highlighting) etc across 1- and 2-column modes.
>
> — Greg, 2026-09-28

Background: [granularity-zoom.md](../project/granularity-zoom.md) (Structure's two faces),
[260910g](260910g-structure-mode-subsumes-outline.md) (why there are two faces), and
[narrow-windows.md](../project/narrow-windows.md) (how the band and the prose share a window).

## Why the columns are narrow — the cause, not the symptom

The two columns live in the **mode band**, and the band is the same width for every mode:
`clamp(avail − PROSE_MIN, MODE_MIN, MODE_IDEAL)` in `fitMode` ([layout.ts](../../src/web/layout.ts)),
so **288–400px, whatever the window**. Structure picks its face from the band's measured width
(`structureFace` in [StructureMode.tsx](../../src/web/modes/structure/StructureMode.tsx)): columns
once the content box reaches `TWO_COLUMN_CONTENT_MIN` = 364px, which at a 16px root is a 389px band.

So today:

- **The columns can never be wider than ~181px each**, on a 1024 iPad or a 2560 monitor alike:
  400 − 1 border − 24 padding − 12 gutter, halved.
- **The switch is at a 945px window** beside the prose (389 + 544 + 12 rail), and — less obviously
  — **at 400px on a phone**, because below a 700px window the band covers the article at the window
  less the rail, with no border, and 388px of band clears the threshold. An iPhone 15 (393) gets the
  list; a Pro Max (430) gets two columns of ~185px. (388px with `?spine=0`.) The first draft of this
  plan said "any phone 389px or wider"; Sol corrected it, finding 3.
- **The text is 13px** (`.struct-row` 0.8125rem) against the list face's 14.6–16.5px tiers, and gists
  are 12px UI type against the list's 15px reading type.

Raising the threshold alone would only hide the columns more often; they would still be 181px when
shown. The band itself has to be wider **when, and only when, Structure's columns are on screen**.

## What changes

### 1. Structure's columns get their own band width

`fitView` learns which band is open (`band: "standard" | "structure"`, from `Reader`). For
`"structure"`, `fitMode` asks one question first: **is there room beside `PROSE_MIN` for two
comfortable columns?** If yes, the band is `min(avail − PROSE_MIN, ideal)`; if not, it is exactly
what every other mode gets today. The band therefore jumps from ≤400 straight to ≥609 at the switch;
there is no in-between band width that would show the list face wider than Greg already likes it.

The prose keeps `PROSE_MIN` (544px) at the switch point — the article is still what is being read,
so the columns take only room the prose was not defending.

`structureFace` keeps measuring the band, against the new threshold. **One function computes the
threshold for both** (`structureColumnsBand` in layout.ts), so the width `fitMode` hands out and the
width the face asks for cannot drift; a test sweeps every window width, at three root sizes and both
rail states, and checks that the band is never in the dead zone between them.

**A band that covers the article always gets the list** (`structureFace`'s `proseBeside`). Below a
700px window the band is painted at the window's width, so measuring it alone would draw the columns
at 620–699px and then the list in a 288px band at 700 — a wider window, a narrower face. Sol's plan
review, finding 1.

### 2. The numbers, and where they come from

The rule: **each of the two columns is at least as wide as the one column Greg says is fine, at its
narrowest.** The list face is most often seen at `MODE_MIN` (a 288px band on a portrait iPad), where
its content box is 288 − 1 − 20 = 267px. Rounded to the rem grid:

| constant | rem | px @16 | why |
|---|---|---|---|
| column minimum | 17 | 272 | ≥ the list face's narrowest content box (267) |
| column ideal | 20 | 320 | ~40 characters at the rows' size; titles are short, and wider only costs the prose |
| column B's bracket | 0.6 + 2px | 11.6 | unchanged; it comes out of B's track, and the tracks are equal, so both carry it |
| gutter | 1 | 16 | was 0.75rem; a wider gutter separates two columns of larger type |
| band padding | 0.75 a side | 24 | unchanged |
| band border | — | 1 | unchanged |

So each track is 272 + 11.6 = 283.6px and the columns need a **609px band** (2 × 283.6 + 16 = 583.2
content, + 24 padding + 1 border, rounded up), and the ideal band is **705px**. Beside the prose
that is a **1165px window** with the rail (609 + 544 + 12), 1153 without it; the ideal is reached at
1261. (The first draft forgot the bracket and said 585, which left column B 260px; Sol's finding 2.)

| window | today | after |
|---|---|---|
| 390 / 393 (iPhone, portrait) | list | list |
| 430 (iPhone Pro Max, portrait) | columns, ~185px | list |
| 744 (iPad mini, portrait) | list, 288 band | list, unchanged |
| 820 / 834 (iPad Air / Pro 11, portrait) | list | list, unchanged |
| 945–1164 | columns, 181px max | list, 400 band |
| 1024 / 1080 (iPad, landscape) | columns, 181px | list |
| 1133 (iPad mini, landscape) | columns | list |
| 1165 (with the rail; 1153 without) | columns | **columns, 272px of content each** — the new switch point |
| 1180 / 1194 (iPad Air / Pro 11, landscape) | columns, 181px | columns, band 624 / 638 |
| 1261 and up | columns, 181px | columns, 320px of content each (band 705) |

The measured version of this table — from Chrome, including characters per line — is in
§ Measurements below, and it is the one to trust.

### 3. One look across the two faces

The list face (outline-mode.css) is the reference, because Greg likes it. Every value the columns
face takes from it is read from **one shared set of custom properties**, declared once on both
bands, rather than copied: `--structure-tier-{cur,near,mid,far}` (the list's four existing sizes,
unchanged). The list face's own values do not change.

| | columns face today | columns face after | list face (unchanged) |
|---|---|---|---|
| row text | 13px (0.8125rem) | `--structure-tier-near` (0.98rem) | tiers 0.91–1.03rem |
| paragraph row | 12.5px (0.78rem) | `--structure-tier-mid` (0.94rem) | tier sizes, weight 400 |
| part rows' weight | 400 | 600 | lvl-1 600 |
| marked rows (`aria-current`) | `--surface-raised` ground, weight 600, both | `--ink` on both (`.here`); the deepest — B's section, else A's part — also `--highlight-wash` at 650 (`.now`) | `.here`: `--ink`; `.now` (deepest): `--highlight-wash`, 650 |
| current section on column B's rail | nothing | 2px `--highlight` thumb on the bracket | `.now.lvl-2`: 2px `--highlight` on the rail |
| rails (bracket, part edge) | `--rule-strong` | unchanged | `--rule-strong` |
| gist | 12px UI face, `--ink-faint` | reading face, `--structure-tier-mid`, line-height 1.4; `--ink` on the current row, `--ink-soft` elsewhere | reading face, 0.94rem, `--ink` |
| apparatus row while you are in it | faint (the bug Sol found in the list, 2026-08-30) | `--ink`, like the list's `:not(.here)` | ink |
| row corner radius | 0.25rem | 3px | 3px |
| hover, focus ring, numbers, read rows | — | unchanged; already the same | — |
| column-B header, counters | 12px / 11.2px | 0.82rem, the numbers' size | (no equivalent) |

## Assumptions (calls Greg's words do not settle)

1. **The band jumps rather than grows**: ≤400 below the switch, ≥609 at it. A list face in a 500px
   band would be a new look Greg has not seen; he said the one column is fine as it is.
2. **Phones lose the columns.** Greg did not mention phones; the rule above excludes them, and the
   list is what he described as fine.
3. **Opening Structure on a mid-width window narrows the prose** more than other modes do (at 1180,
   544px instead of 768). That is the room the columns are made of. At 1440 and up it costs nothing
   visible, since the prose is capped at 65ch in its cell.
4. **Only the deepest marked row gets the wash**, as in the list. The first draft washed both (the
   part in A and the section in B); Sol's finding 4 argued that is two competing "now"s and less
   consistent, not more, and the part already says it is the parent through its connector edge.
5. The column minimum is the list face's narrowest content box; the ideal is 20rem. Revisited only if
   the measurements say a 272px column is not comfortable.

## The simpler option passed over

**Only raising `TWO_COLUMN_CONTENT_MIN`.** One number, no layout change. It would make the columns
rarer and leave them exactly as narrow when shown, since the band never exceeds 400px — the opposite
of "provide more space for the 2 columns".

## Stages

One stage; the pieces are small and share the one threshold.

1. Tests red first: `fitView` for a Structure band at the switch and either side of it; the dead
   zone sweep; `structureFace` at the new threshold; the CSS gutter and padding against the
   constants.
2. layout.ts (threshold + band), StructureMode.tsx (face from the shared threshold), Reader.tsx
   (pass the band), structure-mode.css + outline-mode.css (shared tier properties, the visual table).
3. Docs: granularity-zoom.md (the two faces), narrow-windows.md (the width table), design notes in
   the CSS headers.
4. Browser check (Sonnet subagent) across the widths above: face, band, column widths, font sizes,
   characters per line, the current row's colours, and the other modes' band unchanged.
5. GPT Sol review of the plan before building; of the code after, fixing in place.

## Measurements

Chrome via Playwright on the box, 2026-09-28, `fowler-phrenology` (9 parts, 40 sections), height 900,
rail on unless noted. "chars" is characters of plain English per line at the row's own font, in that
column's content box. There is no measured "before": the first browser pass ran against a dev server
that hot-reloaded this change half-way through, so the old numbers above are from the old code, not
from a browser.

| window | face | band | prose | column A content / chars | column B content / chars | list content / chars |
|---|---|---|---|---|---|---|
| 390 | list (covers) | 378 painted | 378 | — | — | 358 / 49 |
| 430 | list (covers) | 418 painted | 418 | — | — | 398 / 52 |
| 699 | list (covers) | 687 painted | 687 | — | — | 667 / 87 |
| 700–834 | list | 288 | 400–534 | — | — | 267 / 35 |
| 945 | list | 389 | 544 | — | — | 368 / 48 |
| 1024–1164 | list | 400 | 612–752 | — | — | 379 / 49 |
| **1165** | **columns** | **609** | 544 | 284 / 37 | **272.4 / 35** | — |
| 1180 | columns | 624 | 544 | 292 / 38 | 280.4 / 36 | — |
| 1194 | columns | 638 | 544 | 299 / 39 | 287.4 / 37 | — |
| 1261–1920 | columns | 705 | 544–1203 | 332 / 43 | 320.4 / 41–44 | — |
| 1152 `?spine=0` | list | 400 | 752 | — | — | 379 / 49 |
| **1153** `?spine=0` | **columns** | **609** | 544 | 284 / 37 | 272.4 / 35 | — |

**So at the switch each column holds as many characters a line (35) as the list does in a portrait
iPad's 288px band** — the rule the minimum was chosen by, confirmed at the rows' real font.

The look, at 1440 (columns) and 1024 (list), same place in the article (part 5, section 5.3):

- Row text 15.68px in both faces (`--structure-tier-near`). The list's `.now` row steps up to
  16.48px (`tier-cur`); the columns' current row does not, by design — nothing in a column is nearer
  than anything else.
- The path row (list `.here`, column A's part) is `--ink` at its level's weight in both; the deepest
  row (list `.now`, column B's section) is `--highlight-wash` at 650 in both — identical computed
  values.
- The rail thumb is `--highlight`, 2px, in both.
- The current row's gist is 15.04px, reading face, `--ink` in both. Not checked: a non-current gist's
  `--ink-soft`, since no other row drew one at that height.
- Hover is `--surface-raised`; the hover card opened fully inside the viewport.

Other modes: Glossary's band is 400 at 1180 and 1440, against Structure's 624 and 705; switching
between them live reproduces both, with no horizontal scroll at any step.

## Review

**Plan review** (GPT Sol, read-only): APPROVE WITH CHANGES, four P1s, all taken —
[prompt](260928a-structure-two-columns-readable-plan-review-prompt.md),
[answer](260928a-structure-two-columns-readable-plan-review-sol.md). The covering band now always
gets the list; column B's bracket is counted in the threshold (585 → 609); the baseline's phone
claim was corrected; only the deepest current row is washed.

**Code review** (GPT Sol, fixing in place): APPROVE WITH CHANGES (made) —
[prompt](260928a-structure-two-columns-readable-code-review-prompt.md),
[answer](260928a-structure-two-columns-readable-code-review-sol.md). Three fixes: `Reader` hands
`StructureBand` the same root size it handed `fitView`, so a root-size change with no width change
re-decides the face; the threshold is floored above `MODE_IDEAL`, so an absurdly small root cannot
make an ordinary band read as columns; `.struct-line` uses `column-gap`, since moving the gist into
that grid had added 0.4rem above every gist. One non-finding kept: before the first part nothing is
marked, deliberately (structure.ts § no current part).
