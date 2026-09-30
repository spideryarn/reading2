You are doing the code review of a built change in this repo (the current directory is its own git worktree). You may fix what you find inside this change's scope; report anything wider for the author to decide. Do not commit, do not run git commands that change history or the index, do not touch the database or .env files.

The change is commit 92b93962 (see `git show 92b93962`). The plan it was built from, with your own earlier plan review, is docs/plans/260930e-metadata-run-it-without-a-confirm-and-start-again-in-the-rerun-section.md and docs/plans/260930e-plan-review-sol.md.

What it does, from two admin (Greg) requests on /read/<slug>/metadata:
1. Per-mode "Run it" / "Run it again" / "Find more terms" rows start the job on one press — the inline confirm is gone, including before Retry. Cost/refusal facts that only the confirm used to say now sit in a note under the Sketch, Debate and Trajectory rows, used as the button's aria-describedby. The glossary label follows current/stale/absent.
2. useStepJob's Retry now sets `starting` before awaiting `queue.retry`, and `useJobs.retry` returns the new Job so it becomes the watched one (a double-press guard, since the confirm is gone). This affects every caller of useStepJob, not only Metadata.
3. The whole-article reset (ResetArticle, behind the experimental switch) keeps its confirm but moves from a separate subheading+card to the first row inside the modes' card.

Please check especially:
- useStepJob's new `retry`: any state it can get stuck in (e.g. retry refused → starting cleared? the job answered by the route is already terminal? `postFailure` interplay? the effect that clears `starting` via startedId?). Any caller of useStepJob or useJobs.retry whose behaviour changes for the worse (grep src/web for failed.retry, queue.retry, useStepJob).
- ResetArticle's retry path (it has its own `queue.retry` use) — is it now inconsistent, and should it matter?
- The glossary label vs what `done` / `ranAt` actually mean in src/store/pg.ts articleMetadata.
- Accessibility of the notes (ids unique, describedby only when a note exists), layout classes (order-last/basis-full in a flex-wrap row).
- Tests: do the new tests in tests/metadata-rerun-section.test.tsx and tests/metadata-reset-section.test.tsx actually fail when the behaviour is wrong?

Gates you can run: `npx vitest run tests/metadata-rerun-section.test.tsx tests/metadata-reset-section.test.tsx`, `npx vitest run .test.tsx` (all component tests, a couple of minutes), `npm run typecheck` (judge by exit code).

Write your findings to the output as a numbered list: severity (P0-P3), evidence (file:line), what you changed (if you fixed it), or the proposed fix. End with a one-line verdict.
