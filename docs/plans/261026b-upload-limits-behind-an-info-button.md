# The upload limits behind an (i), and the disclosure line left for Greg

Up: [plans.md](../project/plans.md) · Report: `spya-kx8z6d` (Greg, admin, suggestion, 2026-10-25)

> "PDF, web page, Word, Markdown or text file, up to 50 MB. PDFs up to 250 pages; every 50 pages
> counts as one article.
>
> The article's text is sent to a third-party model provider for processing."
>
> Move this to an (i) tooltip.
>
> — Greg, 2026-10-25 (`spya-kx8z6d`)

## What changes

- **The limits** (`uploadLimits()`, src/uploads.ts) leave the visible line under the add row and go
  into the card of an (i) beside the File button: `LimitsInfo` in `src/web/UploadPicker.tsx`, the
  Glossary's *Why a new list?* shape — a `Tooltip` controlled by `usePressToggle`, so hover and
  focus open it and a tap toggles it on a touch screen, with `.tap-target` giving a finger 40px. It
  sits in the `pdfButton` slot, so both pickers get it (the shelf's add box and *Upload a file
  instead*).
- The File button keeps `aria-describedby="upload-limits"`, now pointing at an `sr-only` copy that is
  always rendered, since the card exists only while open. `limitsShown`, which existed so that the
  reference could not outlive the visible line, goes with the line.
- `tests/upload-caps-are-stated-before-the-file-is-chosen.test.tsx` used to assert the caption was
  *not* hidden. It now asserts no visible line carries the limits, a press on the (i) shows both
  numbers and a second press closes it, and the File button is described by the numbers.

## What does not change yet, and why

**Superseded on 2026-10-26:** Greg chose B, and the sentence moved into the same card —
[261026h](261026h-the-provider-sentence-into-the-add-box-info.md). The section below is the
reasoning as it stood.

**The disclosure sentence stays visible** (`ADDING_SENDS_TEXT_AWAY`, `src/web/AddArticle.tsx`). Its
comment records a deliberate commitment: *"Visible at rest while either way in is available, or the
promise is not made"*, made in
[260831an § Confidentiality](260831an-referee-mode-for-peer-reviewers.md) after GPT Sol called the
missing notice the most serious finding in Referee mode — it is what makes Referee's past-tense
*"already sent"* honest. Hiding it is a privacy trade-off, which the brief says goes to Greg: question
[q-p6fvep](../user-feedback/questions/q-p6fvep.md). If he says fold it in, it is one line: put
`ADDING_SENDS_TEXT_AWAY` as a second `TipNote` in `LimitsInfo`'s card and delete the `<p>`.

## Simpler option passed over

Putting the (i) at the end of the disclosure line, in AddArticle. Passed over because the limits
belong to the File control (UploadInstead has the File button but not the disclosure), and an (i)
at the end of a sentence reads as elaborating that sentence.

Plan-review stage skipped as the brief allows for a plan this size; the code goes to GPT Sol.
