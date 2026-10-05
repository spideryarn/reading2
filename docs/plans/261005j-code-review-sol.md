No P0 or P1 findings.

- **P2 — [annotations.css:418](/tmp/spideryarn-worktrees/dark-quote-prose-colour/src/web/styles/annotations.css:418): some low-confidence search outlines lose contrast.** Bluish green at `--hit-a: 0.45` falls from **2.550→2.504**; at zero confidence, **1.647→1.529**. Opaque bands improve for all 16 colours. **Left for your decision:** accepting this loss or changing the confidence outline is a product trade-off. I documented it and kept the palette as built.
- **P2 — [quote-fill.test.ts:238](/tmp/spideryarn-worktrees/dark-quote-prose-colour/tests/quote-fill.test.ts:238): preservation checks were incomplete.** **Fixed:** pinned the original dark spine triplet and extended search coverage from eight to sixteen colours.
- **P3 — [quote-fill.test.ts:348](/tmp/spideryarn-worktrees/dark-quote-prose-colour/tests/quote-fill.test.ts:348): “no worse” was inaccurate.** The cross-reference rule falls **2.5635→2.5562**, hidden by rounding. **Fixed:** renamed the check as minimum floors, tightened its floor to 2.55, and corrected the docs.
- **P3 — [plan:32](/tmp/spideryarn-worktrees/dark-quote-prose-colour/docs/plans/261005j-dark-quote-prose-colour-deeper-purple-spine-keeps-its-own.md:32): incorrect and incomplete numerical claims.** **Fixed:** ink is **8.90→9.56**, rather than 9.29→9.99. Chroma increases about 1.7 times. Tier luminance contrast, the page-coloured gap, and contrast beside reader washes also decline; their OKLab distances improve. All table rows were independently recomputed.
- **P3 — [feedback note:73](/tmp/spideryarn-worktrees/dark-quote-prose-colour/docs/user-feedback/261005_0715-quote-fill-stronger-in-the-dark-appearance.md:73): unfinished or misleading status text.** **Fixed:** removed the placeholder and the claim that this uncommitted work was on `dev`.

Token routing is correct everywhere checked. The new token exists in both theme blocks wherever annotations load. Quotes rows, hover-card scores and ScoreBars require no colour migration. Light values remain unchanged; absent `data-theme` remains the existing dark default, and System resolves through the unchanged appearance code. Greg’s added quotations match the permitted wording. Selection colour remains browser/OS-dependent and unverified.

The actual colour-test source passed **26 assertion groups** in a lightweight Node harness. Separate mutations turned the changed checks red: restoring lavender, changing token routing, adding another live token use, reducing either base rule opacity, changing light or strip values, substituting incompatible prose colours, raising heavy strength, moving reader-highlight hue, and darkening `--cat-14`. `ruleAlpha` reads the base rules and ignores later variants. The changed block-flash literal also rejects the old token. Details are recorded in the plan.

**Vitest is unverified:** the locked mutation attempt exited 1 without output. Direct checks remained queued and were cancelled. No `REFUSING TO START` appeared. Whitespace checking passed. No full suite, browser, build, typecheck, commit or mutating git command ran.

Permanent edits:

- `styles/tokens.css`
- `tests/quote-fill.test.ts`
- `docs/project/quotes.md`
- `docs/user-feedback/261005_0715-quote-fill-stronger-in-the-dark-appearance.md`
- `docs/plans/261005j-dark-quote-prose-colour-deeper-purple-spine-keeps-its-own.md`

Temporary mutations to `annotations.css` and `spine.css` were restored. Only scratch scripts/results under `/tmp/dark-quote-*` were written outside the listed repository files.

VERDICT: do not ship