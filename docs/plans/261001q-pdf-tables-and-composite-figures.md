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

Every route has a narrow idea of what a figure is — one embedded picture; or drawings
with no picture on the page, each panel at least 36 pt a side (the drawn route admits up to
six separate drawings, but Fig 2's legend is a 67×7 pt component); or a box around exactly
one picture — and a multi-panel figure assembled from several PDF objects, like these three,
fits none of them. In production today: **36 PDF figure markers on current revisions, 10
stored, 22 `ambiguous`, 4 `not-located`.** The census proves that multiple-picture ambiguity is the
dominant final refusal; it does not classify how many of those 22 pages hold one composite
figure rather than several unrelated pictures.

## The class

**A transcription or recovery rule that admits only the single-unit case, with the plural
case left as "deferred" — and nothing that counts how often the deferred case occurs.**
Tables: "show a subset" with the cells outside it. Figures: "one picture", "drawings with no picture on the page",
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
  A caption marked `continues` keeps the earlier table only when `continuationTargets`
  accepts that join; otherwise its cells stay with the newly emitted caption.
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
- **The check now gates the cells** (changed after Sol's review, finding 2). `tabledata`
  stays outside `RENDERED`, which is also the in-place vocabulary that continuations, seam
  repair and the front-matter window read. The scorer gates on a new set, `CHECKED` =
  `RENDERED` + `tabledata` (`src/pdf.ts`), so an invented number in a cell becomes a
  content warning as it would in prose. Footnotes stay report-only. The cost: a fresh or
  uncheckpointed chunk whose cells carry a number absent from the text layer is now
  re-read once where it used to pass, then published with the warning if it persists.
  A stored checkpoint is re-scored but is re-read only for a structural fault, not a
  content warning; changing that would change checkpoint policy beyond this stage.
- **Downstream needs nothing new.** A `<figure>` is a leaf block (`src/blocks.ts`) of
  kind `media`, and a `<figure>` holding a `<table>` is what ar5iv's tables already are,
  which the reading view draws. The sanitiser keeps table elements.
- **Forward-only.** Stage 2 has to re-run for an article to change. Because neither the
  prompt nor its fingerprint changed, the run reuses every valid stored chunk
  transcription; it buys only chunks with no reusable checkpoint and the small,
  uncheckpointed front-matter call. Greg's article needs a re-extraction to get its
  tables; this plan does not run one (production write).
- **A re-extracted table gets a new block id** (Sol, finding 3). A `<figure>` is one
  block, its text goes from the caption to the caption plus every cell, and carry-over
  matches whole text. Accepted rather than special-cased: three PDF articles in
  production have tables, a table is rarely where a bookmark or a note sits, and a
  caption-only carry-over rule would be a migration path kept for ever for one change.
- **What the delimiters cannot say** (Sol, finding 11). `|` and newline are what the
  model writes, not a contract the prompt states: a literal `|` in a cell splits it, and a
  line break inside a cell becomes a row. Seam repair (`mendSeamHyphens`) does not reach
  cells. A structured row/cell schema in the transcription is the sound fix and costs a
  `PROMPT_VERSION` bump; deferred until a table is seen to come out wrong.

## Stage 2 — draw a composite figure from the model's box — **not built: deferred**

**Status, 2026-10-01: designed, reviewed, not built.** GPT Sol's plan review
([261001q-plan-review-sol.md](261001q-plan-review-sol.md)) found the acceptance rule
below unsafe as written (P0), and its fixes add up to a project rather than a stage:

- **A wrong region can pass** (P0). `captionPrintedOn` matches a caption's opening
  anywhere on the page, so a prose mention can satisfy rule 1 while the page's only real
  caption is another figure's; and a model box around a captionless *table* can absorb its
  cells as "labels" and pass rule 3. Every page in this paper carries a table. The rule
  needs a positive binding: the caption located at a line start, and a spatial relation
  between that caption and the region, with no table caption between them.
- **The safety vetoes cannot simply be kept** (P1). The drawn route refuses a page whose
  forgiving and strict pdf.js reads disagree, and the layout reader opens the document with
  `maxImageSize: 1`, so **every page with a picture on it disagrees**. Keeping the veto
  refuses Fig 1 and Fig 3 outright; dropping it re-admits the paint pdf.js skips and
  PDFium draws. A layout read that measures pictures is the prerequisite.
- **`other` image paints have no trustworthy box** (P1). Fig 3 has two inline images, and
  the paint interpreter files inline images, repeats, groups and masks under one `other`
  with a placeholder box. Snapping needs them split and bounded.
- And: low-text scans skip `readPdfRasters`' paint read (P1, 6); the located route does
  not read layouts today (7); two located crops of one figure need refusing together (8);
  the renderer draws a 4 pt pad the containment box must match (9); the integration test
  must include a zero-picture page and the adversarial set (10).

**Sol's simpler alternative**, worth trying first when this is picked up: these three
figures are each drawn inside **one printed rectangular frame** that the model's box
matches. Require exactly one such frame on the page, bound to the caption by position,
and render the frame. Narrow — only framed figures — but with a positive ownership proof
instead of an inferred one. Or the whole-page fallback below, which is a product call.

**Which to build is Greg's call**, because the two cheap options change what a reader
sees: a framed-figure-only rule recovers some journals and none of the unframed ones; a
whole page in the figure's place is always available and never the wrong picture, but it
is a page of prose at column width with the figure somewhere on it.

The design as first proposed, kept for the record:

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

## Tests, as built

- Stage 1: `tests/pdf-tables.test.ts` — cells inside the figure after the caption, one
  `media` block, ownership across valid and invalid caption continuations, cells kept
  across a footer at a page turn, two tables, a paragraph retaining its first position,
  orphan cells and figure/prose barriers, a captionless table, escaping, `uncertain`,
  separator-only and empty records. All fifteen are red on the old renderer; the invalid
  continuation case is also red on the first Stage 1 build.
- The gate: two cases in `tests/pdf-score.test.ts` — an invented number in a cell is
  `invented`, while a footnote's stays `unshown`. The cell case is red with `tabledata`
  taken back out of `CHECKED`; the footnote case pins the deliberate contrast.
- Stage 2, when it is built: Sol's list (finding 10) — a zero-picture vector page, a
  different sole caption, a captionless table, a low-text scan, an `other` paint, shading
  or unmeasured paint, two markers choosing one region — plus the real paper by hand.
