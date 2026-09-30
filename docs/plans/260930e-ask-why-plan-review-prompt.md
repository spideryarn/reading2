# Plan review: 260930e — ask why you are reading, and a Trajectory for that intent

Read-only review. Do not change any file.

Review the plan at `docs/plans/260930e-ask-why-you-are-reading-and-a-trajectory-for-that-intent.md`
(untracked in this worktree; read it from disk). The design consult that led to it is
`docs/plans/260930e-ask-why-design-consult-prompt.md` and your own earlier answer
`docs/plans/260930e-ask-why-design-consult-sol.md`.

Check the plan against the code, especially:

- `src/web/AddPage.tsx` — the three completion paths (`done` effect, `alreadyArticle` effect, the
  `{article}` answer in the posting effect), `queueModesOnce`, `offerAutoModes`.
- `src/web/auto-modes.ts`, `src/web/Metadata.tsx` (`savePurpose`), `src/web/lib/api.ts` (cache
  invalidation of `/api/reader` on a `PATCH /api/library/<slug>`), `src/routes.ts` (`patchShelf`,
  `GET /api/reader?slug=`, `resolveProfile`).
- `src/web/TrajectoryPanel.tsx`, `src/web/useTrajectory.ts` (`ensure`, `regenerate`,
  `profileChanged`), `src/web/modes/trajectory/TrajectoryMode.tsx`.
- `src/public/dto.ts`, `src/public-types.ts` for the deferral's stated reason.

Questions:

1. Is the stage-1 completion rule correct and complete across all three paths, including StrictMode
   double effects, a re-add, an upload answered as an existing article, and a job that fails?
2. Is "save, then queue, then navigate" actually sufficient for the queued jobs to be profiled with
   the new purpose (where is the profile resolved, and is any cache in the way)?
3. Stage 2: is `regenerate()`/`ensure()` right after a purpose save, given `useTrajectory`'s own
   state (profileChanged read, automatic run, job de-duplication)? Could the press race the
   automatic run or post a job before the PATCH has landed?
4. Is the deferral reasoning about the public DTO accurate?
5. Anything simpler that gives Greg the same result.

Severity: P0 (data loss / security / wrong for every reader), P1 (a real bug or a plan that will not
work as written), P2 (worth fixing), P3 (nit). Give every finding an ID (F1, F2…), the file:line it
rests on, and a concrete fix. End with a one-line verdict.
