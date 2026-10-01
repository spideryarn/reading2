# PDF tables and figures withheld by a one-thing rule

Report `spya-pawfwx`, Greg, 2026-10-01, on a JCO paper imported as a PDF:

> Why didn't these tables or figures import correctly?

Five tables reached the reader as captions over nothing, and three figures as captions over
*"We couldn't recover this figure from the PDF."* Nothing errored. Each stage did what it was
written to do. The plan with the measurements is
[261001q](../plans/261001q-pdf-tables-and-composite-figures.md).

## What happened

**Tables (stage 2).** The transcription prompt asks for every table's cells as `tabledata`
records and the model writes them. `renderHtml` draws only `RENDERED` types, and `tabledata`
was never in it, so the cells were transcribed, scored as "unshown" and dropped. Every table
in every PDF import since 2026-08-26 was a caption over an empty figure. In production on
2026-10-01, 3 of 12 PDF articles had tables, and none showed a cell.

**Figures (stage 4.5).** All three were composites: six photos in a grid, three vector
charts in one frame, eight blot strips. The bitmap route attaches a picture only when the
page holds exactly one (`ambiguous`). The drawn route refuses any page with a picture, and
any panel under 36 pt. The model locator found all three figures, boxing each figure's
printed frame on the right page. Its judge then refused every answer, because it stores one
embedded picture whole and a composite is not one picture. In production on 2026-10-01, 26
of 36 PDF figures had no picture.

## Root cause

**The first version of each route was built for the single case, the plural case was
written down as deferred, and nothing counted how often the deferred case came up.**

- `tabledata` arrived in `b0bebabea` (2026-08-26). The reason was the check, not the
  reader: a page of table cells failed recall when the model obeyed "do not transcribe a
  table's cells". The comment on `RecordType` says *"Transcribe everything, label it, show a
  subset"*. Showing the cells was never on anyone's list. Footnotes, the other member of the
  hidden subset, were shown on 2026-09-30 because a reader asked. Nobody asked about tables
  until today.
- The figure rules came in `0297784f6` (2026-09-06, bitmap: one picture), `52d8d47a9`
  (2026-09-12, drawn: no picture, panels at least 36 pt) and `b22840083` (2026-09-28,
  located: one picture, refuses `assembly`). Each plan named composites as deferred, and
  each refusal is right on its own:
  *a missing figure is visible; a wrong one is not.* But the manifest records only the
  refusal word, and nobody had ever asked what share of real figures the deferred case was.
  The production census later found 26 final refusals among 36 markers, including 22
  `ambiguous`; that state does not distinguish composites from pages with unrelated pictures.

## The class

**A one-thing rule: a stage that handles only the single-unit case, defers the plural case
in a comment, and has no count of how often that deferral fires.** Every refusal looks
deliberate, because it is. Together they withhold most of the content, and the rule cannot
be seen from inside any one stage, because each stage did the right thing. It sits beside
[260928a](260928a-a-library-field-that-holds-one-value-for-a-list-keeps-one.md), a library
field that holds one value for a list, and is the same shape one level up: a pipeline that
expects one embedded picture where a figure has several panels or pictures.

## The fix

- **Shipped:** `renderHtml` writes each table's cells as a `<table>` inside its figure, and
  the check gates cells like prose (`CHECKED` in `src/pdf.ts`). It is forward-only: an
  article changes when it is re-extracted.
- **Shipped, second:** composite figures. When the locator's judge refuses a box for holding
  several things, `judgeLocatedRegion` renders the box once the page ties it to its
  caption, and the locator is asked about every refused figure. The first design was
  refused by GPT Sol's review, because it could take in a captionless table or another
  figure's region. Greg then set the bar (*"I'd rather accidentally pull in a bit of extra
  stuff … than have no figure imported at all"*), so the rule binds the region to its
  caption instead of proving that every pixel is the figure's. A re-run of the assets stage
  alone recovers an existing article's figures (`pdf-figures/6`).
- **Right for the long term:** a figure is a *region of a page bound to its caption*, not a
  picture. All three routes should end up proving that region and rendering it. The bitmap
  route's "store the embedded picture whole" would then be an optimisation for the
  one-picture case, not the definition.

## What would have caught it, ranked by ease against value

1. **A census of record types: every type is shown, or hidden on purpose with a reason.**
   `tests/pdf-record-types-shown.test.ts`, typed `Record<RecordType, …>`, so a new type
   does not compile until someone decides whether a reader sees it. Red on the old renderer
   for `tabledata` only. **Done.**
2. **Count every refusal word in production, and read the counts before calling a route
   finished.** A `jsonb_array_elements` query over `assets->'pdfFigures'` gives 22
   `ambiguous` out of 36. A route that refuses 60% of its inputs is not done, whatever its
   per-case reasoning says. The read-only production provenance and counts are in the plan,
   and the [article-images.md](../project/article-images.md) bullet now carries the numbers.
   Cheap, but it is a habit, not a check: nothing runs it.
3. **The reader-visible note names the refusal class to the owner.** "We couldn't recover
   this figure" for 26 of 36 figures made the gap look like rare bad luck. Rejected for
   now: `PdfFigureNote.tsx` deliberately names no cause, because a reason under a figure is
   a claim the reader will quote back, and that argument still holds.
4. **An eval corpus of real multi-panel figures with a recovery-rate floor.** The most
   valuable, and the most expensive: it needs committed PDFs, which the repo avoids, or
   synthetic pages, which would share the routes' assumptions. Worth doing alongside the
   stage-2 work, not before.
