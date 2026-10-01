# Key — H3: log how long each pipeline step takes, on the server, for every job
**0. Disposition: already done (no-op), report it.** Since e06bdc58 (2026-08-25) `runStep` in
`src/jobs.ts` writes, under component `jobs`, `step done: <step> — <slug>` at `info` with
`{ step, ms, ...spendFields }`; `step failed:` at `error` with the same `ms`; `step cancelled:` at
`debug` with `ms` and `why`. The job's ending line (`noteEnded`) carries the whole job's `ms`; the
`pipeline` component's line carries the model call's `ms` and tokens; the persisted `JobStep` has
`startedAt`/`finishedAt`. A skipped (cached) step logs at `debug` with no `ms`, by design. The ideal
agent finds the line, says where it is read (Vercel runtime logs), and stops — or, if the asker
wanted a chart or a table, asks Greg what question they want answered.
## 1. Docs it must read
- MUST `docs/project/logging.md` § "What gets logged, and where" (the `jobs` row: "each step's
  transition") and § "What a step or a request cost, in money" ("log at the seam the queue already
  owns, not inside another agent's stage").
- USEFUL `docs/project/ingest-queue.md` (the queue, steps, claims and deadlines).
- USEFUL `docs/project/vercel-hosting-deployment.md` (reading the logs in production).
- USEFUL `docs/project/architecture.md` § "Stage ownership".
## 2. Existing code it must reuse (a second copy is the mistake)
- `src/jobs.ts` § `runStep` — `stepStarted`, `since(stepStarted)`, the `step done` / `step failed` /
  `step cancelled` lines; § `noteEnded` (job total `ms`).
- `src/log.ts` § `log("jobs")` — the Pino logger; components are a closed union.
- `src/ai-spend.ts` § `spendFields` (already on the same line).
- Duplicate shape: a `console.time`/`console.log` in a stage file, a new timer wrapper around
  `STEPS` in `src/pipeline.ts`, a new `durationMs` column or table, or a new log component.
## 3. Code files it would edit
- None. If a real gap were confirmed (e.g. wanting skipped steps at `info`), only `src/jobs.ts`
  and its test (e.g. `tests/step-failure-seam.test.ts` area).
## 4. Project rules that apply
- Log from the server through `src/log.ts`; a `console.log` in a request path is a bug (CLAUDE.md;
  `logging.md`).
- Log at the queue's seam, not inside a stage (`logging.md`; `architecture.md` § Stage ownership).
- Never log article prose or anything sensitive — `step.detail` is deliberately not logged because
  for `extract` it is the article's title (comment in `runStep`; `logging.md` § What never gets logged).
- Check it is not already built (CLAUDE.md "Before rebuilding…"); failing test first; worktree.
## 5. Traps
- Timing is taken with `Date.now()` around the step, not by subtracting the ISO `startedAt` /
  `finishedAt` strings (comment above `stepStarted`).
- Skipped steps are `debug` on purpose: most steps of most jobs skip, and at `info` they would bury
  the lines that matter.
- A job spans several `advanceJob` calls (claims hand back at the deadline), so "the job's duration"
  is not one request's duration; the requeue lines carry `window`.
- Production log level is `info`, so the `debug` cancel line is not visible there.
## 6. Wrong or duplicative actions
- Adding timing inside each stage file (reaches into other agents' stages, and seven places to forget).
- Adding a second, parallel duration line beside `step done`.
- Logging `step.detail` or the slug's title to make the line "more useful".
