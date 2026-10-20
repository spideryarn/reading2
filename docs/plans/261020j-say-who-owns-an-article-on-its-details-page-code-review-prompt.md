You are reviewing, and may fix, the code for plan
docs/plans/261020j-say-who-owns-an-article-on-its-details-page.md in this worktree. Read the plan
(its "What was built" section first) and your own plan review
(docs/plans/261020j-say-who-owns-an-article-on-its-details-page-plan-review-sol.md). The diff of
commit HEAD is in docs/plans/261020j-code-review.diff.

Look for: correctness bugs; any way the admin line could show another reader's private-link article
owner, or ask /api/admin for a non-admin or an unconfirmed session; staleness when slug or reader
changes; wording that claims ownership it does not know; places that should hear about the new
Access section or the new strings and do not (docs, help, tests such as
tests/public-network-trace.test.tsx's request expectations or copy tests); and test gaps (each
test should be one that could go red).

Fix what you find inside this stage, keeping the code idiom of the surrounding files, and run
`npx vitest run tests/article-ownership.test.tsx` plus any suite you touch, and `npm run typecheck`.
Do not commit. Do not touch the production database. Report anything wider for me to decide.

Write your findings, numbered, most severe first, each with file:line, and what you changed for
each, to the output file FIRST before making edits, then update it at the end.
