# Narrow check: the fixes for S1-F7 and S1-F8 only (plan 261025h, Stage 1)

Repo: this worktree. Read-only. Discovery is closed: this is a check of two fixes made after your round 2 (docs/plans/261025h-stage1-review2-sol.md), not a new review.

- S1-F7: `bylineAuthors` in src/citation-index.ts (`git diff HEAD -- src/citation-index.ts`, and the new tests in tests/citation-index.test.ts).
- S1-F8: the operator stripping in src/situate.ts (brackets to spaces; `word:value` stripped only for an all-lower-case ASCII word; leading -/+ and bare OR/AND/NOT), tests in tests/situate.test.ts.

Question, with a floor: for each, is this statement accurate? "S1-F7: a surname-first byline (`Smith, Jane; Jones, John`, and the comma-only form) now matches its OpenAlex authors, and the round-1 cross-boundary false positive still gives none." "S1-F8: no `word:value` operator in lower-case ASCII, no leading unary sign and no bare upper-case boolean, bracketed or not, survives into a sent query; and a capitalised `Mind:Version` in a title is kept." Answer yes, or give the counterexample. Run `npx vitest run tests/citation-index.test.ts tests/situate.test.ts`. Do not change any file.
