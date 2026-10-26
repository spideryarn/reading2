# Code review: 261026f Stage 1 (Possible citations, server side)

You are reviewing, and you may fix what you find inside this stage's files, in the worktree you are
in. Plan: docs/plans/261026f-cited-by-when-there-is-no-doi-from-the-full-text-and-a-web-search.md
(Stage 1, decisions 1–6, and § GPT Sol's plan review, your own earlier review). Evidence: the diff
docs/plans/261026f-stage1-code-review.diff; the measurement
docs/investigations/261026a-cited-by-with-no-doi-full-text-and-web-search-recall-and-cost.md and its
script scripts/spikes/261026a-cited-by-full-text.ts.

Files in scope: src/citation-fulltext.ts (new), tests/citation-fulltext.test.ts (new),
src/citation-index.ts (openAlexInTurn widened, articleYear exported), src/types.ts
(PossibleCiters; `possible` on no-doi and no-match), src/routes.ts (GET /api/citers/:slug
?with=possible), src/store/pg.ts and src/store/contracts.ts (loadArticleIdentity carries filename),
src/web/PrivacyPage.tsx and tests/privacy-page.test.ts, docs/project/privacy.md.

Not in scope, and do not touch: src/web/useCiters.ts, src/web/ReceptionAndClaimsPanel.tsx,
src/web/WhereItSitsPanel.tsx (another session's unpushed work changes them; Stage 2 will).

Look for: anything that sends an upload's title, or anything beyond the phrase and a year range, to
OpenAlex; a title that can change the filter's meaning; the gate's arithmetic against the plan's
decision 3; the own-record rule against F5; anything in a log line that carries the phrase; the
route's 400s and its behaviour for every CitersResult kind; whether `possible` can reach a visitor
(it must not); type holes (`exactOptionalPropertyTypes` and `noUncheckedIndexedAccess` are on); and
tests that would still pass with a rule broken. Project rules: CLAUDE.md;
docs/project/security-map.md; docs/project/logging.md.

Write your findings first to docs/plans/261026f-stage1-code-review-sol.md: numbered S1-F1…, each
with severity (P0/P1/P2), evidence (file:line), and what you changed, if anything. Then make the
fixes you are confident of, inside the in-scope files only, and run
`npx vitest run tests/citation-fulltext.test.ts tests/privacy-page.test.ts tests/citation-index.test.ts`
and `npm run typecheck`, and report their results at the end of the findings file. Report anything
wider for me to decide rather than changing it.
