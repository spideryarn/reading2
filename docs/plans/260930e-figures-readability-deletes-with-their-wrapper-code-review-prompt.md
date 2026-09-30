# Code review: 260930e stage 1 — figures Readability deletes with their wrapper

You reviewed this plan before it was built
(`docs/plans/260930e-figures-readability-deletes-with-their-wrapper-plan-review-sol.md`) and supplied
the rollback page (`…-p1-4-question-sol.md`). Stage 1 is now built and committed as `ef741a00`.

Read:

1. The plan, especially § *Stage 1, as built*:
   `docs/plans/260930e-figures-readability-deletes-with-their-wrapper.md`.
2. The scoped diff: `docs/plans/260930e-figures-readability-deletes-with-their-wrapper.diff` is not
   it — use `docs/plans/260930e-figures-readability-deletes-with-their-wrapper-code-review.diff`
   (everything under `src/`, `tests/` and `docs/project/` this stage changed).
3. The code in full where it matters: `src/protect.ts` (rule C: `unwrapFigureWrappers`,
   `unwrapInside`, `unwrapAround`, `readabilityWouldTakeItForItsLinks` and its helpers, the
   `WITHDRAWALS` row), `src/furniture.ts` (the new entry and `isFigureButton`), and how both are
   called from `prepareDocument` / `readingArm` / `armThatKeptTheProse` in `src/extract.ts`.
4. The tests: `tests/extract-figure-wrappers.test.ts` (new) and the changed residual tests in
   `tests/extract-protect.test.ts`. The fixtures are `tests/fixtures/figure-wrappers/*.html`.
5. Readability 0.6.0 itself, `node_modules/@mozilla/readability/Readability.js`: `_cleanConditionally`,
   `_getClassWeight`, `_getLinkDensity`, `_getInnerText`, `_getCharCount`.

Run, at least:

```
npx vitest run tests/extract-figure-wrappers.test.ts tests/extract-protect.test.ts tests/extract-furniture.test.ts
npm run typecheck
```

What I most want checked:

- **Is the copied gate faithful to Readability?** Weight from class and id, link density with the
  0.3 fragment coefficient, the comma count, the thresholds. Anything Readability does to the node
  between our pass and `_cleanConditionally` (DIV→P conversion, `_cleanStyles`, hidden-node removal,
  `_fixLazyImages`, the flag retries that switch `FLAG_WEIGHT_CLASSES` off) that makes our estimate
  systematically wrong in a way that matters?
- **`unwrapAround`'s loop**: is the walk correct after an unwrap, can it loop forever, and can it
  climb out of the figure's own region into something it should not touch?
- **`isFigureButton`**: can it delete an author's words? Construct the shape if you can.
- **`kept`**: does it ever claim something false? The Quanta case is documented as "a wrapper, not
  necessarily a picture" — is that honest, or should the count change?
- **Tests**: do any pass for the wrong reason? Would they go red if the rule were broken in the
  obvious ways?
- **Docs**: is anything in the plan, `docs/project/article-images.md` or
  `docs/project/content-extraction.md` now false?

**You may fix what you find inside this stage** — the files above — and must leave anything wider
(another stage's code, a defence, the production re-run list's substance) as a finding for me. Do not
commit. After fixing, re-run the tests above.

Write to the output file: each finding numbered with severity (P0/P1/P2), the evidence, and either
*fixed — how* or *left for you — why*. End with the test results you saw and a one-line verdict.
