# Probe H3 : log each pipeline step's duration, server-side, every job

## 1. Docs opened, in order
- `CLAUDE.md` (AGENTS.md) - pointed me at logging.md via "Log from the server" rule; helped.
- `docs/project/logging.md` (grep + sections 155-172, 200-235, 412-422, 895-925) - helped: component table, `jobs` and `pipeline` components, the "what a step cost" section.
- `docs/project/ingest-queue.md`, `docs/project/performance.md`, `docs/project/debugging.md` (grep only for timing/duration) - nothing relevant to server step timing.
- I did not open architecture.md or testing.md in detail.

## 2. Code files you would edit
- Likely none for the core request: `src/jobs.ts` already logs `ms: since(stepStarted)` on `step done` (about line 1202), on failure (about 1264), on stop/deadline (about 1243), and `ms` for the whole job in `noteEnded` (about 1723).
- Only if a gap is wanted: `src/jobs.ts` for skipped/cached steps, since the per-step line is `info` only when the step ran. `src/log.ts` `since()` is the clock helper.
- A test would go in `tests/` (e.g. a new `tests/step-duration-is-logged.test.ts`, modelled on `tests/checkpoint-hit-rate-is-logged.test.ts` and `tests/all-skipped-publication-log.test.ts`).

## 3. Existing helpers to reuse
- `src/log.ts` § `since`, `log("jobs").child({jobId, slug})`.
- `src/ai-spend.ts` § `spendFields` (already spread into the step line).
- `src/jobs.ts` § `stepStarted` / `jlog.info(... "step done")` - this is the feature already existing.
- No new helper needed.

## 4. Rules to follow
- Log from the server through `src/log.ts`, never `console.log` in a request path (CLAUDE.md, logging.md).
- No article prose in logs; ids, slugs, counts, timings only (logging.md).
- Info = "you would want it a week later"; debug for skipped steps (logging.md level table).
- Test first, watch it go red; `npm test` + `npm run typecheck` at the end (CLAUDE.md).
- Plan doc + GPT Sol review before commit; worktree; commit own files by name; push to dev (CLAUDE.md).
- Keep the logger stateless / child logger (logging.md, Fluid Compute).

## 5. Where you got lost
- The task as phrased is largely already implemented; the docs do not say so in one place. logging.md mentions `ms` on the `pipeline` line and `ms` in the example, but I only confirmed the per-step `ms` on the `jobs` line by reading `src/jobs.ts`. A doc line "every step logs `ms` on `step done`, under component `jobs`" is missing.
- Unclear whether the task wants skipped (cached) steps timed too; no doc says whether they are logged at all.
- I did not run the code or tests (probe rules), so I did not verify the output format.

## 6. Confidence
7/10 that I found everything; the main risk is that the intended gap (skipped steps, or a job-level breakdown) is something I guessed.
