# Plan review: stage 2, show Brief as soon as it is written, then a longer Fuller

You are reviewing a **plan**, read-only. Change no file.

## The candidate

- Base: `0a79cedea` (stage 1 is committed and on dev).
- The candidate is one section of a modified, uncommitted file:
  `docs/plans/261004f-stop-writing-the-simple-summary-level.md` § *Stage 2*. `git diff HEAD -- `
  that path shows exactly the addition. Nothing of stage 2 is built.

## Start with (does not limit scope)

- `src/jobs.ts`: where a step's `ctx` is built (`report`), `note()` / `noteProgress`, step
  success and failure paths, anything that copies, resets or logs `job.steps`
- `src/store/pg-jobs.ts` § `noteProgress`, `toJob`, and what an interrupted or retried attempt
  does to a step's fields; `src/store/session.ts` § `commit`
- `src/simple-summary.ts` § `generateSimpleSummary` / `writeLevel`
- `src/web/useSimple.ts`, `src/web/useStepJob.ts`, `src/web/jobEngine.ts`,
  `src/web/SimplePanel.tsx`, `src/web/JobProgress.tsx`
- every route or view that returns or lists jobs (owner's `/api/jobs`, admin, fleet, export)
- `docs/project/summaries.md`, `docs/project/security-map.md`, `docs/project/logging.md`

## What to attack, independently

Greg's decision is not under review: Brief is shown first, and Fuller is asked for about 500 words.
The design choice is: is "carry Brief on the live job row, store both at the end" right, and is it
safe?

1. Check the plan's two facts against the code. If a step *can* store mid-run through an existing
   seam, say so with the path.
2. `JobStep.preview` holds a model's words about a reader's article, personalised to their profile.
   Trace every place a job's `steps` goes: responses, logs, Sentry, admin and fleet views, exports,
   the public payload, retention. Is there any path where it reaches someone other than the owner,
   or is logged? Is clearing it on success enough, and does anything re-add or copy it?
3. Concurrency in the job engine: a `noteProgress` from inside a running step, racing the step-end
   write, a lease renewal, a cancel, a stale attempt. Can a late preview write land after the step
   finished and resurrect a cleared preview or clobber a newer `steps`? `ctx.preview` is called
   from inside `Promise.allSettled` while Fuller is still running.
4. The client: with nothing stored and a job running, can the band draw the preview without a
   state where it flashes empty, draws Brief twice, or shows a stale preview from an earlier job
   for the same article? What happens on a forced rewrite (Metadata's Rerun) while an old summary
   is on screen: should the preview replace the old Brief or not?
5. `simple-prompt/8`: find anything that treats an outdated summary as a reason to write without
   a forced press (auto-run, the add page's main-modes job, a re-ingest, `stepIsDone`). The rule
   is that a stored summary is rewritten only by Rerun in Metadata.
6. Is anything in the build order missing, or is there a smaller design that gives the reader the
   same thing?

You have no network and no Postgres.

## Output

Findings `S1`, `S2`, … each graded by consequence and marked **established** (an exact source
path) or **reasoned**:

| | |
|---|---|
| P0 | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| P1 | user-visible wrong behaviour, or an authoritative contract violated |
| P2 | design or maintainability risk with no wrong behaviour today |
| P3 | non-behavioural prose or comment defect |

End with a verdict: approve, or refuse (only on an established P0 or P1 in the design).

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The late-write race in point 3.
- Whether an unforced multi-step job that includes `simple` rewrites an outdated summary today
  (that would predate this plan, but `/8` makes every stored row eligible).
- Whether clearing the preview on success is worth its code, against leaving it on the job row.
