# A narrow check of one fix: F36, the recovery policy bump

Read-only. **Not** a new review — discovery on stage 1 is closed. One question, and a small one.

Your narrow check of the F35 fix (`docs/plans/260912a-figure-2-vector-figures-from-a-pdf-f35-check-sol.md`)
found the render path sound and one gap, F36: `PDF_FIGURE_RECOVERY_POLICY` stayed at `pdf-figures/2`,
so a drawn figure stored by the pre-containment code (`0201fdfc`) read current and would be served
without passing the check.

The fix is the single commit **`b8c761e0`** on top of `a4bcb82b`: the policy is now `pdf-figures/3`,
with its comment. `git show b8c761e0` is the whole of it. My evidence, run on the local Postgres your
sandbox cannot reach: after the bump, `npx tsx scripts/stage.ts assets entropy-24-00930-spya-pywwkq`
**without** `--force` ran — its `pdf-figures/2` manifest read stale — and finished `figures: 4,
figuresStored: 4, figuresDrawn: 1`; typecheck exit 0; 157 tests in `tests/collect-assets.test.ts`,
`tests/collect-pdf-figures.test.ts`, `tests/pdf-figure-containment.test.ts`,
`tests/pdf-figure-region.test.ts`, `tests/pdf-figure-render.test.ts`, `tests/pdf-figure-strict.test.ts`,
`tests/doc-links.test.ts` green.

**The question: does the fix close F36, and so F35?** In particular — does every path by which a
manifest is judged current (the stage stamp in `src/pipeline.ts`, the store's freshness check in
`src/store/pg.ts`, anything that carries a manifest forward into a new revision) now see
`pdf-figures/3` for an article with PDF figure markers, and still see no change for a web article
without them? Is there any other way a pre-containment drawn figure stays served?

Answer with findings `F37`, `F38`, … only if it does not (P0–P3 by consequence; established or
reasoned), and a one-line verdict: **F35 closed** or **F35 still open** (IDs).
