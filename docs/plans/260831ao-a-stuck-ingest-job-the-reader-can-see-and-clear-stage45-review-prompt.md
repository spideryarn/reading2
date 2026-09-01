# Review the built code for Stages 4 and 5

You have reviewed the plan and every stage of this work. **Stages 4 and 5 are now built and
committed.** Read the code at HEAD. This is the reader-facing half, so weight what a person actually
sees at least as heavily as the types.

## What was built

**`src/job-state.ts`** — `displayJob(job, now)` → `{ state, step, elapsedMs, usually, retryable,
sentence }`. Pure, clock injected, takes no lease. Eight states: `waiting | working | slow | stopping
| interrupted | failed | stopped | done`. Also `elapsedLabel`, `driverStalled`,
`DRIVER_STALLED_AFTER = 3`, and five reader-facing sentence constants.

**`UseJobs` gained `driverFailures`**, straight off the engine snapshot.

**`AddArticle.tsx` / `JobProgress.tsx` / `AddPage.tsx`** — a running step reads
`Building the hierarchy · 2m 14s · 18k characters of tree so far`, with the measured "usually" line;
the state sentence under the step list; the stalled-driver sentence under that, only while live; and
`Keep a Spideryarn tab open while this imports…` once per shelf while something is importing.

## The decisions to check

1. **The threshold is per step, not global.** Six minutes into `hierarchy` is ordinary; six minutes
   into `fetch` is a fetch that is never coming back. Only two steps have evidence: `hierarchy` (6
   runs, median ~409s → "a few minutes", slow at 10 min) and `sketch` (13 runs, median ~144s → "two
   or three minutes"). Everything else gets a default marked **GUESS** and says nothing to the
   reader. Is the evidence bar right, and are the two sentences honest for the spread of the data?
   Note `LEASE_MS` self-aborts at 740s, so the 10-minute `hierarchy` warning has a ~2.3 min window
   before the step is killed — is that the right place for it?
2. **`interrupted` is `job.error === INTERRUPTED.message`**, not `failureKind === "retry"`. The
   implementer rejected reading the `[jb-gone]` code back out of the message on the grounds that the
   code mechanism exists for surfaces that keep only `err.message`, and a job is a struct with a
   field. Agreed, or is comparing against a prose constant fragile?
3. **Transport health is kept out of `displayJob`** — not a fact about the job, not on `Job`, and
   `job-state.ts` is shared with the server. `driverStalled(failures, id)` is separate, threshold 3
   (~24s given the 8s backoff). It is rendered on `JobCard` and **deliberately not** in
   `JobProgress`, because that would thread a prop through eight panels' hook call sites for a
   surface watching one artefact rather than an import. Is that gap acceptable or does it hide the
   stall exactly where a reader would be waiting?
4. **The card runs its own clock** via `useNow(1000)` while busy, a day otherwise. Necessary because
   `ctx.report` writes `step.detail` in memory and never persists it, so a job six minutes into a
   step returns a byte-identical record every poll and `sameJobs` correctly suppresses the
   re-render. Is the idle interval right, and does anything leak a timer?
5. **No terminal duration is shown at all.** Your Stage 3 review warned that `startedAt` survives
   retries and so measures total job age. The implementer's answer: `job.startedAt` is never read;
   `step.startedAt` is re-stamped every time a step starts, so for a running step it is the current
   attempt's; and the untrustworthy `job.finishedAt − job.startedAt` is never computed. **The gap it
   states rather than papers over:** nothing records when the *current attempt* began, so a
   job-level "this attempt has been going N" is not derivable from `Job`. Is per-step the right
   granularity to settle for, or is a `attemptStartedAt` worth adding?

## Two process facts you should weigh

- The implementer ran **22 targeted reversions**, one per behavioural claim. **21 went red. One did
  not**: *"does not mention tabs when nothing is importing"* passed with `importing` forced true,
  because the fixture's `finishedAt` put the job behind the "1 earlier import" chevron so no card
  rendered at all — the absence being asserted was the absence of everything. Fixed and then watched
  red. **Look for other negative assertions with the same shape** in the three new test files.
- It found a regression of its own that the known-failing list would have hidden:
  `tests/client-imports.test.ts` gates what the browser bundle may reach out of `src/web` for, and
  `job-state.js` had to join the shared allowlist.

## Questions

1. Take each of the five decisions above in turn.
2. **Do the tests pin what they claim?** Name any that would pass against a broken implementation,
   and specifically any other negative assertion that could pass because nothing rendered.
3. **The copy.** Read the five sentences as a reader would. Are they plain, true, and do they say the
   thing itself? `docs/project/copy.md` now carries a paragraph on why they live in `job-state.ts`
   and carry **no bracketed codes** — the argument being that a code exists so somebody can quote it
   when reporting a problem, and none of these is a problem. Is that right?
4. **Is `displayJob` genuinely pure and genuinely total?** Malformed, future, and missing
   `startedAt`; a job with no steps; a step list where none is running; a `cancelling` job that is
   also slow.
5. **Anything that will bite Stage 6** (the structured 409), which is the only stage left.
6. Anything else a code review can see.

The plan is `docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md`. Files:
`src/job-state.ts`, `src/web/AddArticle.tsx`, `src/web/JobProgress.tsx`, `src/web/AddPage.tsx`,
`src/web/useJobs.ts`, `tests/job-state.test.ts`, `tests/job-card-progress.test.tsx`,
`tests/job-progress-band.test.tsx`. Several agents share this tree; ignore hunks belonging to a
Review→Remember rename and to referee mode.
