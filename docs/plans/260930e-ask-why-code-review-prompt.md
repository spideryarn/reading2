# Code review (reviewer-fixer): 260930e — ask why you are reading, and a Trajectory for that intent

You are reviewing, and fixing what is inside this change. Repo: the current directory (a git
worktree). The change under review is `git diff 0593b571..fd03e37e` — three commits:

- `0646e12b` the plan: `docs/plans/260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md`
  (read it first; § Stage 1, § Stage 2, § Tests are the spec). Your earlier plan review is
  `docs/plans/260930e-ask-why-plan-review-sol.md`; findings F1–F8 were taken as the plan says.
- `2313b333` stage 1: `src/web/AddPage.tsx` (the purpose box, the completion state machine
  `running | ready | saving | opened`, the once-guard), `src/web/purpose.ts` (new), `src/web/Metadata.tsx`
  (now uses `savePurpose`), `src/web/useJobs.ts` + `src/web/AddArticle.tsx` (F3: retry answers with the
  replacement job and the add page follows it), `tests/add-page-purpose.test.tsx` (new), test fakes.
- `fd03e37e` stage 2: `src/web/TrajectoryPurpose.tsx` (new), `src/web/TrajectoryPanel.tsx`,
  `src/web/styles/trajectory.css`, `tests/trajectory-purpose-line.test.tsx` (new), docs.

Look especially for:

1. Any path where a purpose is lost, erased (a PATCH of null/empty from the add page or Trajectory),
   or where modes are queued before the save answers, or queued/navigated twice.
2. Any completion path in AddPage that no longer opens the article (a job that fails then is
   retried, an upload answered as an existing article, the retention `{article}` answer, the reader
   leaving focus in an empty box, re-renders of `completion` while `ready`).
3. A new `completion` arriving while phase is `ready`/`saving` for an older one (e.g. address change,
   Retry), and whether the posting effect's reset of `phase`/`claimed` is correct.
4. Stage 2: whether `ensure()` after the save really results in a re-planned route when a route
   planned without a purpose exists (trace the server: `POST /api/jobs` → the trajectory step's
   freshness in src/pipeline.ts), and whether the box can race the automatic run.
5. Anything a visitor could see of the owner's purpose.

Run the two new test files yourself (`npx vitest run tests/add-page-purpose.test.tsx
tests/trajectory-purpose-line.test.tsx`; they need no network).

**Fix** what is inside this change, narrowly, red-first (write or adjust a test that fails, then fix).
**Report, do not fix**, anything wider you notice. Do not commit. Do not touch `src/public/`,
`src/auth.ts`, `src/routes.ts` defences, or anything under `infra/`.

Write your answer as: findings with IDs (C1, C2…), severity P0 (data loss / security / wrong for
every reader), P1 (real bug), P2 (worth fixing), P3 (nit), each with file:line, whether you fixed it,
and the test that proves it; then the list of files you changed; then a one-line verdict.
