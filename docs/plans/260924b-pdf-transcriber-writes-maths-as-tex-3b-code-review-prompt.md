# Code review: stage 3b, HTML imports write maths as delimited TeX

Write-capable, in spideryarn2; `CLAUDE.md` once. Base: `HEAD` (`2cc54abf`); stages 1–3 are committed
in `42cb3bf5`. Nothing of 3b is committed. **Other agents are editing OTHER files in this tree; touch
only the files listed here.** See each modified file with `git diff HEAD -- <file>`; the untracked
ones are whole new files.

Modified: `src/extract.ts` (the `canonicaliseMaths` call in `prepareDocument`; `MIGHT_HOLD_MATHS` and
the loader in `runExtract`), `src/pdf-tex.ts` and `src/pdf-read.ts` (the loader moved to
`maths-server.ts`), `tests/pdf-tex-stage-loads-temml.test.ts` (mock retargeted),
`tests/cold-start-lazy-imports.test.ts` and `tests/pdf-bundle-trace.test.ts` (comments),
`tests/extract-protect.test.ts` and `tests/table-oracle.test.ts` (two repinned numbers, with reasons),
`docs/project/content-extraction.md`, `docs/project/maths.md`,
`docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md` (§ Stage 3b and the opening).

Untracked: `src/maths-import.ts`, `src/maths-server.ts`, `tests/maths-import.test.ts`,
`tests/maths-import-stage-loads-temml.test.ts`, and the 3b plan review
`docs/plans/260924b-pdf-transcriber-writes-maths-as-tex-3b-plan-review-sol.md` (K1–K8; the plan
says what was done with each).

## The conclusion to check

"Every formula on the three corpus pages that carries its TeX source becomes `\(…\)`/`\[…\]` in block
text (598 of 598), drawn by the reading view; a conversion that cannot be made leaves the page's
own form; the conversion changes nothing but the maths blocks (same block counts, same recogniser
stats, only maths blocks reminted); and temml is loaded in a way the built function traces, only for
pages that might hold maths." The finding I would least like to be wrong about: **a page where the
conversion deletes or corrupts content that is not the formula** — a wrapper with more in it, a
formula inside something the reading view will not draw, a TeX string that escapes its delimiters in
the stored HTML or in the reading view's span scan.

## What to do

Attack independently first. Then fix what is inside this stage, narrowly and red-first (a failing
test first, seen to fail), only in the files above; report, do not fix, anything wider. Gates:
`npx vitest run tests/maths-import.test.ts tests/maths-import-stage-loads-temml.test.ts
tests/pdf-tex-stage-loads-temml.test.ts tests/pdf-tex.test.ts tests/extract-sanitize.test.ts
tests/extract-unhide.test.ts tests/sanitize-mathml.test.ts tests/maths.test.ts` and
`npm run typecheck` (read its exit code). No paid calls; no full suite.

Severity: P0 data loss/security/charging; P1 user-visible wrong behaviour; P2 design risk; P3 prose.
Mark established or reasoned. IDs from **L1**. For each: severity, evidence (file:line), fixed (with
test) or reported. One-line verdict.

## My suspicions (mine, worth less)

1. `withoutStyleWrapper` on `{\displaystyle a}{b}` — braces balance overall but the first group
   closes early; I think the depth check refuses it, but check.
2. A MathJax script inside a KaTeX or MediaWiki wrapper, or nested `<math>` — the loop takes a live
   snapshot of `querySelectorAll`, so a replaced ancestor's descendants are still iterated.
