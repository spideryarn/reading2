# Review round 2: Stage 1 of plan 261025h — the fixes for S1-F1 … S1-F6

Repo: this worktree. Read-only. Round 1 is docs/plans/261025h-stage1-review-sol.md (yours). The fixes are unreviewed code by another agent.

## The candidate (live, pre-commit; another agent edits src/web/** concurrently — out of scope except NotCitedPanel.tsx)

Same scope as round 1: `git diff HEAD -- src/citation-index.ts src/store/pg-citation-index.ts src/situate-citers.ts src/situate.ts src/related-work.ts src/routes.ts src/types.ts src/messages.ts src/web/NotCitedPanel.tsx src/db/schema.ts docs/project/reception.md docs/project/sources.md tests/citation-index.test.ts tests/citation-index-pg.test.ts tests/situate.test.ts tests/related-work.test.ts tests/not-cited-panel.test.tsx` plus the untracked drizzle/20261025185019_* and tests/fixtures/openalex/*extended-mind*.json.

The fixes as the implementer describes them: S1-F1 one-to-one author matching (`matchedAuthors`, `articleAuthorNames`, replacing `agreeingAuthors` and `twoStructuredAuthorsAgree`, for every title match); S1-F2 the Since check acts only on a code-owned piece year (metadata, ≤ this year) and structured source years (arXiv id, Springer/Elsevier ids, a citer's year); S1-F3 `titleIsAnEdition` needs an explicit marker word, `doiExtends` deleted; S1-F4 a surname whitelist, and every query loses `word:value` tokens, leading -/+ and bare OR/AND/NOT; S1-F5 the topic list fetched only for `?about=topic`; S1-F6 topic provenance logged.

## What I want

Is each round-1 finding now closed, by its own counterexample and by the class it named? Did a fix break something that worked (e.g. one-to-one matching refusing true matches the old rule accepted — check the existing citation-index tests' cases; operator stripping mangling ordinary titles with colons)? Discovery is closed for new general findings — report only (a) a round-1 finding still open, or (b) a P0/P1 a fix introduced. Run `npx vitest run tests/citation-index.test.ts tests/situate.test.ts tests/related-work.test.ts`. Same severity scale; IDs continue from S1-F7. Do not change any file.
