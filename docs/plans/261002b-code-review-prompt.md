# Code review: 261002b — Greg's three answers

You are reviewing a small change in this repo (Spideryarn). Read
`docs/plans/261002b-greg-answers-citations-cap-import-report-summary-on-add.md` for intent, then the
diff in `docs/plans/261002b-code-review.diff` (the working tree also has it applied).

Fix what you find inside this scope directly in the working tree; report anything wider for me to
decide. Do not commit. Do not run `npm run db:migrate` or anything that changes a database other
than the per-run test database the suite creates itself.

Please check especially:

1. **Dismiss now stamps `jobs.dismissed_at` instead of deleting** (`src/store/pg-jobs.ts` §
   `forget`, `list`, `get`). Is there any other reader of a job by id or by owner — in
   `src/store/pg-jobs.ts` (claim, advance, enqueueOrGet's re-read, retry, settleExpired,
   trimFinished), `src/jobs.ts`, `src/routes.ts`, or other `src/store/pg-*.ts` files that select
   from `jobs` — where a dismissed row that previously would have been absent now changes
   behaviour visibly to the reader or wrongly (e.g. a uniqueness/arbitration check, an upload
   recovery path such as `jobForUpload`/`queueAnUpload`, a shelf or delete path, billing)? Name
   the file and line, and say whether it matters.
2. Is `trimFinished` still correct with dismissed rows (they still take retention slots — is that
   acceptable or harmful)?
3. The citations fuse: `INVESTIGATE_RATE_POLICY.daily.globalFills` 25 → 62 for a $50 ceiling.
   Is there any other place that states or depends on the $20 / 25 figure (docs, comments, tests,
   UI copy)?
4. Are the tests meaningful — would they fail if the change were reverted?
5. Doc accuracy in `docs/project/feedback.md`, `docs/project/ingest-queue.md`,
   `docs/project/summaries.md`, `docs/project/citations.md`.

Gates you may run: `npx vitest run tests/store-jobs-parity.test.ts tests/citation-investigate.test.ts
tests/import-report.test.ts tests/auto-modes.test.tsx` and `npm run typecheck`.

End with a verdict line and a list of findings (P0–P3), each with what you changed, if anything.
