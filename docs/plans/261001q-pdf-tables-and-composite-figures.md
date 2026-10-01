# A PDF's tables and composite figures reach the reader

Report `spya-pawfwx`, Greg, 2026-10-01, on a JCO paper imported as a PDF
(`jco-2005-01-libre-spya-hk9cc7`):

> Why didn't these tables or figures import correctly?

Five tables came through as five captions over nothing, and three figures as three
captions with *"We couldn't recover this figure from the PDF."* under them. Stage 4.5 and
stage 2 both did exactly what they were written to do. That is the problem.

## What happened, measured

Read from production inside `begin read only` (revision `92823017…`, made 2026-10-01
12:33), and the stored source fetched from the `sources` bucket (sha256 `41bb039d…`,
matches `raw_sha256`).

**Tables — stage 2, `renderHtml` in `src/pdf-read.ts`.** Rule 7 of the transcription
prompt asks for each table's caption as a `table` record and its cells as `tabledata`
records, and the model obeys (on the eval corpus it writes `cell | cell`, one row per line
or per record). `tabledata` is not in `RENDERED` (`src/pdf.ts`), so the cells are
transcribed, scored, and never written. Every table in every PDF import is a
`<figure><figcaption>Table N…</figcaption></figure>` with nothing in it. In production
today, 3 of the 12 PDF articles on a current revision have tables, and none of them shows a
cell. The comment on `RecordType` says why it was built so — *"Transcribe everything,
label it, show a subset"* — and `tabledata` is the one subset member never revisited.
Footnotes were in the same state until 260930k showed them.

**Figures — stage 4.5, `src/collect-pdf-figures.ts`.** All three are composites:

| figure | what it is | bitmap route | drawn route | located route |
|---|---|---|---|---|
| Fig 1, p4 | six IHC photos in a framed 3×2 grid, with labels | `ambiguous` (6 pictures) | refused: pictures on the page | model's box = the frame; judge refuses (several pictures in the box) |
| Fig 2, p5 | three vector charts (A, B, C) in a frame | `no-raster` | `not-located` (`small-component`) | model's box = the frame; judge refuses (no picture to point at) |
| Fig 3, p6 | eight blot strips in two rows, two inline images, labels | `ambiguous` (8 pictures) | refused: pictures on the page | model's box = the frame; judge refuses |

Reproduced locally with the real locator (three calls, `google/gemini-3-flash-preview`):
the same three failures, and the model's boxes were the figures' frames on the right page
every time — `[492,80,870,919]` on p4, `[75,128,570,871]` on p5, `[750,79,893,703]` on p6.
**The model found the figures; the judge threw the answers away**, because
`judgeLocatedBox` stores an *embedded picture, whole*, so a box has to point into exactly
one picture, and rule 6 refuses one with a neighbour (`assembly`).

Every route defines a figure as one thing — one embedded picture, or one connected drawing
— and a multi-panel figure is neither. In biomedical papers that is most figures. In
production today: **36 PDF figure markers on current revisions, 10 stored, 22 `ambiguous`,
4 `not-located`.** Most of the 26 are this.

## The class

**A transcription or recovery rule that admits only the single-unit case, with the plural
case left as "deferred" — and nothing that counts how often the deferred case occurs.**
Tables: "show a subset" with the cells outside it. Figures: "one picture", "one drawing",
"one picture in the box". Each refusal is correct locally; together they withhold most of
what a scientific PDF has in it. The postmortem is
[261001b](../postmortems/261001b-pdf-tables-and-figures-withheld-by-a-one-thing-rule.md).

## Stage 1 — show the cells (`src/pdf-read.ts`)

`renderHtml` gathers each `table` record's `tabledata` and writes them inside its figure,
after the caption:

```html
<figure><figcaption>Table 3. HER-2 Status…</figcaption>
  <table><tbody><tr><td>…</td><td>…</td></tr>…</tbody></table></figure>
```

- **Which rows belong to which table.** A run of `tabledata` belongs to the nearest
  `table` record before it, when only `tabledata`, page furniture (`publisher`,
  `footnote`) and nothing rendered lies between. That is the order rule 7 asks for, and
  it is the same "floats and furniture" vocabulary `continuationTargets` already uses.
  A run with no table to belong to (a table the model gave no caption, so `renderHtml`
  skips its empty `table` record) renders as a `<figure>` holding just the `<table>`,
  in place: the cells are the author's, and dropping them is today's bug.
- **Rows and cells.** Each `tabledata` record is split on newlines into rows, each row on
  `|` into cells, trimmed. A row with one cell is one cell. No header guessing — the model
  is not asked which row is a header, and a wrong `<th>` is worse than none.
- **Escaped like every other string** (`escapeHtml`); `uncertain` puts `pdf-uncertain`
  on the `<table>`. The model still writes no tag.
- **No prompt change, no `PROMPT_VERSION` bump.** The cells are already transcribed, so
  no cached chunk goes stale and no import pays for this. That is how 260930k showed
  footnotes. A `|` the model did not use leaves a row of one cell — readable, and visible.
- **The check is unchanged.** `tabledata` stays outside `RENDERED`, so the scorer still
  reports rather than fails on it, which is the footnote stance (`RENDERED`'s comment),
  stated there as the same gap.
- **Downstream needs nothing new.** A `<figure>` is a leaf block (`src/blocks.ts`) of
  kind `media`, and a `<figure>` holding a `<table>` is what ar5iv's tables already are,
  which the reading view draws. The sanitiser keeps table elements.
- **Forward-only.** Stage 2 has to re-run for an article to change, and re-running it on
  a PDF re-buys the transcription. Greg's article needs a re-extraction to get its
  tables; this plan does not run one (production write).

## Stage 2 — draw a composite figure from the model's box (`src/pdf-figure-locate.ts`, `src/collect-pdf-figures.ts`)

When `judgeLocatedBox` refuses an answer because the box holds **no single picture**
(`not-one-picture`) or **a picture with neighbours** (`assembly`), a second, pure judge,
`judgeLocatedRegion`, decides whether the box can be **rendered** instead — the drawn
route's renderer (`renderPdfRegion`), the drawn route's storage (`storeOne`). Its rules,
in order:

1. **One figure on that page.** The page prints exactly one figure-caption opening
   (`PRINTED_CAPTION_START`, the drawn route's rule 1b) and it is this marker's caption
   (`captionPrintedOn`). This is what makes a wrong figure unreachable rather than
   unlikely: there is no other figure on the page for the box to be around. Tables do not
   count; a page of two figures stays refused (deferred, as on the drawn route).
2. **The box is snapped outwards to whole things.** Every image paint, ink box and short
   text line (a label: not `isProse`, not caption-like) that the box intersects is taken
   in whole, to a fixpoint, so nothing is cut through. If snapping grows the box's area by
   more than `MAX_SNAP_GROWTH` (proposed 1.5×), refuse: the box was slicing through
   something large.
3. **No prose and no other caption inside.** No text line that is prose (the drawn
   route's `isProse`: ≥ `PROSE_MIN_WORDS` words and ≥ 30% of the page wide), no
   caption-like line (`Fig N`, `Table N` — including its own caption), and nothing in the
   furniture margins, intersects the snapped region.
4. **Sane geometry.** Unrotated page with a zero-origin view box; region at least
   `MIN_REGION_SIDE_PT` on a side and at most `MAX_REGION_AREA_FRACTION` of the page; no
   image paint in it covers more than `BACKGROUND_SHARE` of the page (a scan, whose text
   layer cannot vouch for rule 3); the page's text layer is not empty.
5. **Nobody else's.** No usable picture in the region is one another route already
   stored (`taken`).

The renderer is handed the region as its own containment box — everything PDFium draws in
it is admitted, because rule 3 is what stands behind its contents, not ink ownership. The
layout is read with the existing `readPdfPageLayouts` (text and ink) and the window's
`readPdfRasters` paints (pictures), both already read on this route.

**Asking more often.** Today the located route asks only when the window holds a usable
picture nobody has — *"which is what keeps a paper of vector figures free"*. With a judge
that can use an answer about a vector figure, that gate would keep Fig 2 unasked in a paper
without pictures. So the gate becomes: ask for any held marker, still capped by
`MAX_LOCATE_CALLS` (8) and `MAX_LOCATE_LOOKS`. Cost: ~$0.002 a call, at most ~$0.016 an
article, only for figures both deterministic routes refused. Greg's standing call was
*"For now let's just do it for figures that fail"*, and these are those.

**`PDF_FIGURE_RECOVERY_POLICY` → `pdf-figures/6`**, so a PDF article's assets read stale
and a re-run of the **assets stage alone** recovers its figures — no re-extraction, no new
block ids. Not run on production here.

**What it does not do.** Two figures on one page; a figure whose box the model gets wrong
on a one-figure page in a way rules 2–3 cannot see (a box around a table, say — rule 3
refuses a table's caption inside, not a captionless table); text drawn as outlines, which
the text layer cannot see, so rule 3 is vacuous on it. The last is the residual risk worth
naming: the region could include prose set as paths. Rule 4's empty-text-layer refusal
covers the whole-page case only.

## The simpler options passed over

- **Show the whole page** when every route refuses. One rule, never a wrong picture, but
  the reader gets a page of prose at column width to find the figure in. Kept as the
  fallback idea if stage 2's refusals turn out common.
- **Pictures as ink on the drawn route.** Tried on the three pages: the band and ownership
  rules (6 pt touch gap, caption-below band, `small-component`, the layout reader's
  `maxImageSize: 1` making every picture page fail `strict-mismatch`) refuse all three for
  three different reasons, and loosening them re-litigates a reviewed ruling. The model
  already finds the figure; only the acceptance rule needed widening.
- **Change the prompt to mark header rows.** Costs a `PROMPT_VERSION` bump and an eval;
  deferred until a reader asks for header styling.

## Tests

- Stage 1: `renderHtml` on records with a table and two `tabledata` rows; with
  furniture between; an orphan run; `|`-less rows; escaping; `uncertain`. Watch them red
  on today's code first.
- Stage 2: `judgeLocatedRegion` as synthetic boxes — the three real pages' geometry,
  two-figure page refused, prose-in-region refused, snap growth refused, background
  refused, taken refused. An integration test in `tests/collect-pdf-figures.test.ts` with
  a scripted locator over a fixture page that has two pictures, red today (`ambiguous`)
  and stored after.
- The real paper, by hand: `collectPdfFigures` with the real locator on the production
  PDF, all three stored, PNGs looked at.
