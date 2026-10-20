Code review of plan 261020a, built. You may edit files in this worktree to fix what you find (workspace-write), within the scope of this change; report anything wider instead of fixing it. Do not run git commands that change history or the index (no commit, reset, checkout, stash, restore, rebase). Do not touch the production database, .env files, or infra/.

The plan, with your own plan review folded in: docs/plans/261020a-add-page-asks-why-higher-and-about-you-says-when-it-is-ready-and-shows-import-progress.md (its § Review lists how each of your nine plan findings was handled). Your plan review: docs/plans/261020a-add-page-plan-review-sol.md. The scoped diff against HEAD (generated with `git diff HEAD`, not kept) (src/web/AddPage.tsx, src/web/AddArticle.tsx, src/web/JobProgress.tsx, src/web/styles/profile.css, src/jobs.ts, src/pipeline.ts, src/store/pg-jobs.ts, src/types.ts, tests/add-page-purpose.test.tsx, tests/job-card-progress.test.tsx, tests/jobs-walk.test.ts, tests/store-jobs-parity.test.ts, docs/project/ingest-queue.md, docs/project/reader-profile.md).

Check especially:
1. AddPage: the About-you hold, the Open-waits effect and its dependency list, `openWithoutSaving` abandoning the profile, the leave warning, any way a reader's words in either box are lost or the page waits forever or leaves while they type; the repeat-paste path; StrictMode; the purpose box's existing behaviours unchanged apart from position and size.
2. jobs.ts `stepNotes`: the throttle, `settled` guard, ordering with `settle()` before the commit on success and failure, StaleAttemptError swallowed, `delete step.progress` at start.
3. pg-jobs.ts `settledSteps`: dropping `detail` on running steps in both branches — anything else that relies on a running step's detail surviving a settlement (e.g. the interrupted error sentence path, tests, the UI)?
4. Whether the tests would catch regressions (each was watched red under mutation, per the plan).

Gates you can run: `npm run typecheck`; `npx vitest run tests/add-page-purpose.test.tsx tests/job-card-progress.test.tsx tests/jobs-walk.test.ts tests/store-jobs-parity.test.ts` (the last two need the local Postgres, which is up). Do not run the full `npm test`.

Write your findings first, numbered and ranked by severity with file:line evidence, then what you changed for each, to the output file.
