Code review of commit c1b82989e (run `git show c1b82989e`) in this worktree, built from plan docs/plans/261009d-every-version-of-an-arxiv-paper-is-one-article.md and its plan review (…-plan-review-sol.md).

The change: arXiv `key` in src/paper-sources.ts § arxivPaper is built from `workId` (no version) so `urlKey` (src/ingest.ts) treats every version of a paper as one article; eleven tracking params added to TRACKING in src/ingest.ts; tests in tests/ingest.test.ts, tests/paper-sources.test.ts, tests/find-article.test.ts (DB-backed; it was seen red without the fix); docs in docs/project/ingest-queue.md and fetching.md.

You may FIX what you find inside this stage (edit files in this worktree; do not commit, do not touch .env.local, infra/, or any database other than the local test one). Report anything wider for me to decide.

Look for: any caller or test that still assumes a versioned key; stale comments or docs anywhere in src/, docs/project/, tests/ that still say a version separates two articles (grep widely, e.g. "v1", "version", "versionedId"); whether the other paper sources (Hugging Face, alphaXiv, DOI) are consistent; whether any tracking param could be a real content parameter; correctness of the new tests. Run `npx vitest run tests/ingest.test.ts tests/paper-sources.test.ts tests/find-article.test.ts` and `npm run typecheck` after any edit.

Answer: numbered findings (P1/P2/P3, file:line), what you changed for each, and a one-line verdict.
