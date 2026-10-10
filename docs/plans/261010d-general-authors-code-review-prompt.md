You are reviewing CODE in the Spideryarn repo, in this worktree, with write access. You reviewed the plan earlier (docs/plans/261010d-general-authors-plan-review-sol.md: verdict "revise before build", four findings). This is the code built after it.

Read:
- docs/plans/261010d-a-general-authors-pass-for-every-web-page.md (the revised plan, with "The plan review" section saying how each of your four findings was handled)
- docs/plans/261010d-general-authors-code-review.diff (the scoped diff), or `git diff HEAD` (new files are intent-to-add)
- src/front-matter-authors.ts (new), src/extract.ts (readingArm, runExtract), src/pipeline.ts (the wiring), src/latexml.ts (latexmlTitleBlock removed), src/models.ts / src/ai-call.ts / src/cost-categories.ts / src/plain-words.ts (the job registered)
- tests/front-matter-authors.test.ts
- evals/front-matter/measure.ts, compare.ts; results in evals/results/front-matter-authors-2026-10-09/run-5-final-haiku.* (the final measurement)
- docs/project/security-map.md (a stranger's page and a model's output are both untrusted)

Judge, with severity P0/P1/P2:
1. Did each of your four plan findings actually get fixed in code, not just in prose? Try to break `ownedBy` and `checkFrontMatterAnswer` with a concrete adversarial page + model answer that stores a wrong or unprinted affiliation, or drops/merges/reorders a declared author.
2. `markHidden` / `pageOpening`: can hidden text still reach the records (a stamp lost through prepareDocument, the prose-retention fallback arm, protect.ts rules, cloning)? Can a stamp leak into stored HTML? Is the walk bounded?
3. runExtract: is the call made only when declared names exist and none has an affiliation, after every refusal, once per extract (including when armThatKeptTheProse runs a second arm)? Does an abort propagate and a failure degrade to the declared names?
4. The job registration: anything missing that other jobs have (tests that enumerate jobs, cost tracking, the reasoning table, the model list, docs/project/ai-gateway.md or cost-tracking.md tables)? Run the relevant tests.
5. Anything the removal of src/arxiv-affiliations.ts / latexmlTitleBlock broke or left stale (comments, docs, tests, evals).

Fix what you find INSIDE this change, with a failing test first where it is a behaviour bug, and run `npx vitest run tests/front-matter-authors.test.ts` and `npm run typecheck`. Do NOT commit, push, or touch .env.local, infra/, or any database. Report anything wider for the author to decide.

Write your answer as: a numbered findings list (severity, file:line, what, and what you changed or recommend), then the list of files you edited, then a one-line verdict: "ready to push", "ready to push after the fixes above", or "not ready".
