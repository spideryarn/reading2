# Stage 1 code review, and fix: recovering PDF figures that are drawn rather than pictured

You are a **reviewer-fixer**, write-capable in this worktree. Review the stage-1 code, **fix what is
inside this stage** — narrowly, red-first (a test that fails before your fix and passes after) — and
**report, do not fix**, anything wider you notice, so the caller can decide. Do not commit; leave
your changes in the working tree. Do not touch `docs/`, `vercel.json`, the reading view (`src/web/**`),
or any file in `docs/project/security-map.md` § Where the defences physically live.

## The candidate

- Base: **`831e42c3`**. Stage 1 is the single commit **`STAGE1_SHA`** on top of it:
  `git show --stat STAGE1_SHA` lists every changed path; `git diff 831e42c3 STAGE1_SHA` is the diff.
  Start with these, and it does not limit where you read:
  - new: `src/pdf-figure-region.ts` (pure rules), `src/pdf-figure-layout.ts` (pdf.js page read),
    `src/pdf-figure-page.ts` (pdf-lib one-page cut + image walk), `src/pdf-figure-render.ts`
    (PDFium in WASM);
  - changed: `src/collect-pdf-figures.ts`, `src/collect-assets.ts` (captions helper,
    `assetsInputHash` policy element), `src/assets.ts` (three new failure words), `src/pipeline.ts`,
    `package.json` (`@embedpdf/pdfium` 2.15.0);
  - tests: `tests/pdf-figure-region.test.ts`, `tests/pdf-figure-render.test.ts`,
    `tests/pdf-figure-page.test.ts`, and additions to `tests/collect-pdf-figures.test.ts`,
    `tests/collect-assets.test.ts`.
- The plan it implements: `docs/plans/260912a-figure-2-vector-figures-from-a-pdf.md` — § Which pages
  are eligible, § Finding the rectangle, § The rest of the shape, § Security, and both review tables
  (your earlier findings F1–F14 and what was taken). Fable's ruling admitting disconnected drawings
  (with three extra refusals) is in the plan's § Round two; it is decided, so do not re-litigate it —
  but do check the code implements it and the refusals exactly.
- Fixtures: `tests/fixtures/pdf-vector-figure/entropy-24-00930-p8.pdf` (the report's page),
  `evals/pdf/titles/arxiv-arnn-eeg-stamp/source.pdf` (p2, p3), `evals/pdf/harder/source.pdf` (bitmap
  figures, must be unchanged).

**Run the tests yourself**: `npx vitest run tests/pdf-figure-region.test.ts
tests/pdf-figure-render.test.ts tests/pdf-figure-page.test.ts tests/collect-pdf-figures.test.ts`.
They need no database or network. `tests/collect-assets.test.ts` may need Postgres; if it cannot run
in your sandbox, say so rather than skipping it silently — my run of it is `EVIDENCE_FILE`.

## What I want

An independent attack first:

1. **A wrong picture under a caption.** Can any path through `pdf-figure-region.ts` and the wiring
   store a region that is not the page's area directly above this caption, or that contains a
   drawing or text the eligibility and ownership rules say must refuse the page? Construct layouts.
2. **The image walk and the bitmap route's refusals** (your F2): can a page with any image —
   XObject, inline, in a pattern, a Type 3 glyph, a soft mask, a nested form, an image pdf.js dropped
   for size — reach PDFium? Can the walk say "no image" when it failed to look?
3. **PDFium lifecycle and failure**: handles freed on every path; one init; serial renders; a
   missing wasm or a throwing render becoming `render-failed`, never a crash of the step and never
   a partial or wrong picture. Coordinates across the pdf.js/PDFium seam (your F7).
4. **The bookkeeping contract** of `collectPdfFigures`: every marker still gets exactly one entry;
   the clock, the abort signal, the article byte budget and `MAX_FIGURE_BYTES` all still hold for
   the drawn route; a straggler cannot write after the race. The bitmap route's outputs unchanged.
5. **Freshness**: `assetsInputHash` changes for a PDF article with markers, and for no web article.
6. **Tests that pass while the feature does nothing** — assertions a no-op would satisfy, a real
   fixture that is never actually rendered, a mutation the suite would not notice. Mutate and check.

## Severity, IDs, what a refusal takes

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Findings `F15`, `F16`, … (continue the chain). For each: severity; established or reasoned;
**fixed** (with the test that went red then green) or **reported** (with the change you would make).
Established means direct evidence — a failing run, an exact reachable path — with no unresolved
inference.

End with the list of files you changed, and a one-line verdict: **ready**, **ready after your fixes**,
or **not ready** (IDs).

## My own suspicions — already mine, worth less; spend most of the run elsewhere

- The caption match and the one-printed-caption count (F13) on real caption punctuation.
- Whether the foreign-text rule (F12) is scoped to the crop rectangle and nothing wider.
- Whether a label that touches two components can make disconnected drawings look owned.
