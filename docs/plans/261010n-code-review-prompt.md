You are reviewing code before it lands, in the Spideryarn repo (cwd, a git worktree). Per the house
workflow (docs/reusable/codex-cli-as-subagent.md § The house workflow): fix what you find inside
this change's scope directly in the working tree, and report anything wider for me to decide. Do
not commit, do not run git commands that change history or the index, and do not touch files
outside this change unless a fix requires it.

The plan, with your own plan review and how each finding was taken:
docs/plans/261010n-reception-says-plainly-why-it-is-empty-and-finds-an-arxiv-paper-s-doi.md
(your plan review is docs/plans/261010n-plan-review-sol.md).

The change is the diff of this worktree against origin/dev: run `git diff origin/dev -- src tests docs`
(and `git status` for new files). Files:
- src/messages.ts (receptionResponsesNoneSuggested, receptionResponsesUnverified, sourcesClaims*, CITERS_NO_DOI)
- src/web/ReceptionAndClaimsPanel.tsx § emptyGroupNote
- src/web/sub-modes.ts § SOURCES_SUB_MODES.claims
- src/article-registry.ts § withRegistryFacts (arXiv DOI kept)
- src/citation-index.ts § citersIdOf, citersOf
- src/store/pg.ts § loadArticleIdentity, src/store/contracts.ts, src/types.ts comment
- tests: article-registry, backfill-registry-facts, citation-index, reception-and-claims-panel
- docs: reception.md, 261004h pointer, the question file docs/user-feedback/questions/q-hbg65m.md and two notes in docs/user-feedback/

Check especially:
1. Every reader-facing sentence is true in every case it is shown (emptyGroupNote's three branches, the shared/visitor path untouched, legacy claim groups), plain, and singular/plural correct.
2. The arXiv DOI at import: any import path where `record.doi` for an `arxiv:` id could be something other than 10.48550/arxiv.<id>, or where keeping it now changes pipeline carry-over (src/pipeline.ts around metadata re-runs), the backfill script's writes, or the library/export.
3. citersIdOf: precedence, an existing non-DOI `doi` value, versioned arXiv addresses, the cache key shape the DB allows.
4. Tests: does each new assertion fail without the change? Anything missing?
5. The question file body: plain text only (no markdown), under 6,000 characters, one `Details` line; accurate to the code.

Run `npx vitest run tests/citation-index.test.ts tests/article-registry.test.ts tests/backfill-registry-facts.test.ts tests/reception-and-claims-panel.test.tsx tests/feedback-endings.test.ts` and `npm run typecheck` after any fix.

Write findings numbered C1.., each with severity (P1/P2/P3), evidence (file:line), and whether you fixed it (and how) or are reporting it. End with a one-line verdict: LAND, LAND AFTER FIXES, or DO NOT LAND.
