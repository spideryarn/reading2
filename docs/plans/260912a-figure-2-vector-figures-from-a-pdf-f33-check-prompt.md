# A narrow check of one fix: F33, the strict operator-list pass

Read-only. **Not** a new review — discovery on stage 1 is closed. One question.

Your stage-1 code review (`docs/plans/260912a-figure-2-vector-figures-from-a-pdf-code-review-sol.md`)
ended **not ready** on F33: pdf.js runs with recoverable errors, so a malformed paint operator can be
dropped from the operator list while PDFium still draws it into the crop, and ownership never
measured it. You proposed a strict second operator-list pass on drawn candidates, refusing unless
strict and permissive reads prove the same complete paint set. That was taken, and built after your
review, so nothing has checked it.

The fix is the single commit **`F33_SHA`** on top of `7d3303ab`; `git show F33_SHA` is the whole of
it. It also carries F34, a behaviour-preserving split of the layout interpreter and the resource walk
into smaller helpers — read that only as far as it bears on F33.

**The question: does the fix close F33?** In particular —

1. Is the strict read really strict (errors surface rather than being recovered), and is it run on
   every page that can reach PDFium, and only those?
2. Is what it compares with the forgiving read enough that a page whose forgiving list *omits* paint
   cannot pass — or can a malformed operator be dropped by both reads alike, or be dropped in a way
   the comparison does not see?
3. Does a strict read that throws, times out or is aborted refuse the page rather than fall through?
4. Is the red-first test's malformed operator one pdf.js genuinely recovers from in forgiving mode —
   i.e. would the test have failed without the fix? Run it: `npx vitest run
   tests/pdf-figure-layout.test.ts tests/pdf-figure-region.test.ts tests/collect-pdf-figures.test.ts`
   (whichever exist); they need no database.

Answer with findings `F35`, `F36`, … only if the fix is incomplete (P0–P3 by consequence;
established or reasoned), and a one-line verdict: **F33 closed** or **F33 still open** (IDs).
