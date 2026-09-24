# Narrow code review: the synchronous temml fallback removed

Write-capable, repo spideryarn2; `CLAUDE.md` once. **Review only this fix.** Base `HEAD`; the fix is
uncommitted, and these are the only files it touches (see each with `git diff HEAD -- <file>`):

`src/maths-server.ts`, `tests/maths-import.test.ts`, `tests/pdf-tex.test.ts`, `tests/pdf-read.test.ts`,
`tests/extract-protect.test.ts`, `tests/table-oracle.test.ts`, `tests/pdf-tex-stage-loads-temml.test.ts`,
`tests/maths-import-stage-loads-temml.test.ts`, `tests/pdf-bundle-trace.test.ts` (comment),
`evals/extraction/{arms,probe,provenance,table-oracle,tidy}.mts`,
`evals/pdf/{bakeoff/score,bakeoff/detail,item-boundaries/compare}.mts`, and the last Log entry of
`docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md`. **Other agents edit other files in this
tree; touch nothing else.**

## Why

`src/maths-server.ts` had a synchronous fallback, `createRequire(import.meta.url)("temml")`, which
`tests/env-reads-are-literal.test.ts` and `tests/env-names-are-inventoried.test.ts` refuse
(`require-identifier`). The fix removes it rather than adding an allowance to that sweep's roster,
which must not be done. Now `texWouldDraw` returns `false` until `loadMathsRenderer()` (a literal
`await import("temml")`) has run. The two stages (`runPdfExtract`, `runExtract`) load it; every test
and eval that reaches the check without a stage now loads it itself.

## What to check

1. Is there any remaining caller — test, eval, script, or `src` path outside the two stages — that
   reaches `texWouldDraw` (via `mathsAsText`, `plainMaths`, `comparisonWords`, `withoutRepeats`,
   `wordsOf`, `structuralIssues`, `scorePage`, `check`, `canonicaliseMaths`, `readArticle`,
   `readArticleWithProvenance`) with maths in its input and without loading? Such a caller now
   silently measures or asserts a different behaviour from production.
2. Do the two stage wiring tests still fail when their stage's load is removed (the author commented
   each out and saw red; confirm by reading), and could anything in their files load temml for them?
3. Is the top-level `await` in the eval modules safe for everything that imports them (tests
   included)?
4. Do the env tests pass, and is there no `require`/`createRequire` left in the maths path?

Gates: `npx vitest run tests/env-reads-are-literal.test.ts tests/env-names-are-inventoried.test.ts
tests/maths-import.test.ts tests/maths-import-stage-loads-temml.test.ts tests/pdf-tex.test.ts
tests/pdf-tex-stage-loads-temml.test.ts tests/pdf-read.test.ts tests/table-oracle.test.ts` and
`npm run typecheck` (read the exit code). Fix inside this fix, red-first; report anything wider.
Severity P0–P3, established/reasoned, IDs from **M1**, one-line verdict.
