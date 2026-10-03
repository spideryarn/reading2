# Code review request: 261002j (Illustrated steering note), built

You are reviewing BUILT CODE in this worktree, with workspace-write access. House rule: **fix what
you find inside this change's scope** (with a test that goes red first where the finding is a bug),
and report anything wider for me to decide. Do not commit. Do not touch any database, `.env*`,
`infra/`, or files unrelated to this change. Do not run `npm run db:migrate` or any command against
a database other than the per-suite test databases `npx vitest run <file>` creates.

Read first: `docs/plans/261002j-illustrated-steering-note.md` (the plan, amended after your plan
review in `docs/plans/261002j-illustrated-steering-note-review-sol.md`).

The diff: use `git diff origin/dev -- <files>` for exactly these files, which are
mine:

- `drizzle/20261002232435_jobs_illustration_note.sql`, `src/db/schema.ts` (jobs.illustration_note)
- `src/types.ts` (Job.illustrationNote), `src/store/pg-jobs.ts`, `src/store/jobs.ts` (WorkKeyExtras),
  `src/jobs.ts` (EnqueueRequest, enqueue, sameWork, retryJob, step ctx)
- `src/routes.ts` (parseIllustrationNote, parseJobRequest, publicJob)
- `src/illustrated-plate.ts` (Illustrated.note, MAX_ILLUSTRATION_NOTE_CHARS, checkIllustrationNote, stored reader)
- `src/illustrated.ts` (inputFingerprint note line, isStale, noteSection, renderPrompt, generateIllustrated)
- `src/pipeline.ts` (StepContext.illustrationNote, illustrated stamp/run/log)
- `src/store/pg.ts` (illustratedIsCurrent)
- `src/web/useStepJob.ts` (StepRun.illustrationNote, stepRunRequest), `src/web/useIllustrated.ts`,
  `src/web/IllustratedView.tsx` (useSteerNote, SteerBox, YourNote, PaintAgain, Empty),
  `src/web/JobProgress.tsx` (runDisabled), `src/web/styles/diagram-illustrated.css`, `src/web/styles/voices.css`
- `evals/illustrated/run.ts` (--note)
- tests: `tests/jobs.test.ts`, `tests/illustrated-plate.test.ts`, `tests/illustrated-run.test.ts`,
  `tests/illustrated-step-registration.test.ts`, `tests/illustrated-view.test.tsx`
- docs: `docs/project/illustrated.md` § The reader can say how it should come out, `docs/project/dictation.md`

What I most want checked:
1. Every path a job is built or copied: is the note frozen, carried by Retry, absent where intended
   (successors, reset), and can any path drop it silently?
2. Freshness: step stamp (job note) vs post-run `sourceHash` (same ctx) vs read sites (artefact's
   note). Any loop, never-done or false-current case? Is `else delete run.illustrated.note` right?
3. The route: any way to get an unchecked note onto a job (upload branch, URL branch, readThis,
   retry route, reset route, `POST /api/jobs` handler spreading `work`)? Refusal messages must not
   contain the note (they are logged).
4. The client: dictation guards (armed and readOnly, button disabled too, per
   docs/project/dictation.md § Adding it to a box), the pre-fill effect (does a picture arriving
   overwrite what the reader typed? does a repaint with a cleared box leave a stale value?), the
   automatic run still unforced and note-less, the `keepDictation("illustrated:<slug>")` key, and the
   reader font rule (docs/project/fonts.md).
5. Anything that makes the plan's claims false.

Write your findings (P0/P1/P2, file:line) to the output file, and for each say whether you fixed
it and which test proves it. Then list every file you changed. Run `npm run typecheck` and the
test files above with `npx vitest run <files>` before you finish, and report the results.
