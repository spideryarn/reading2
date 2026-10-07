**Refuse.** The job-row preview is a reasonable design, but the plan leaves established P1 violations unresolved. No files changed; no network or Postgres used.

**S1 — P1, established: `/8` enables unforced rewrites of stored summaries.**

[`simple.stamp`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/pipeline.ts:4181) includes `SIMPLE_PROMPT_VERSION`. [`stepIsDone`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/pipeline.ts:1179) compares that stamp; [`sameStamp`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/store/artifacts.ts:1046) requires matching prompt versions. Consequently, an unforced job containing `simple` rewrites a usable `/7` summary after `/8` ships.

The Summary door itself is safe: `useAutoRun` spends only when status is `none`. But that is a client guard, not the server’s completion rule. The add page’s [`auto-modes`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/web/auto-modes.ts:64) includes `simple` and submits unforced jobs.

This predates Stage 2, but `/8` makes every existing summary eligible. Before the bump, establish and test that a usable stored summary skips an unforced `simple` step regardless of prompt age. Merely adding `isDone` will not suffice: the current stamp branch takes precedence.

**S2 — P1, established: forced rewrites remain available outside Metadata.**

The stated rule is “stored summary rewritten only by Rerun in Metadata.” Existing Summary controls violate it:

- [`SimplePanel`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/web/SimplePanel.tsx:124) calls `owner.regenerate()` from *Write it again*, including the stale-summary branch.
- [`OwnerSimple`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/web/modes/summary/SummaryMode.tsx:143) gives the profile badge a regeneration action.
- [`useSimple.regenerate`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/web/useSimple.ts:151) explicitly forces `simple`.

The plan’s “door or forced rerun” wording is broader than Greg’s rule. Include removal or redirection of these controls in the build.

**S3 — P1, established: the planned client handoff loses its preview before the stored read arrives.**

[`useStepJob`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/web/useStepJob.ts:487) exposes only running or queued jobs as `job`. On the completion poll, that becomes `null`; [`useJobs`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/web/useJobs.ts:327) then triggers the refresh through an effect. Until its GET completes, `useSimple` still has `simple: null` and status `none`.

Clearing the server preview and rendering only a running job’s preview therefore creates an empty interval. Matching paragraph text does not prevent it.

Failure has another gap: [`StepFailure`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/web/useStepJob.ts:206) contains no job or preview. A failed job leaves `job`, so changing only `useSimple` and `SimplePanel` cannot read its retained paragraphs through the existing interface.

Specify a preview lifecycle tied to the observed job ID: retain it through the successful read handoff, expose the watched failure’s preview, and discard it when a successor becomes current. Add `useStepJob` to the build scope. Test actual hook transitions with a deferred completion GET, a failed completion GET, failure, retry, and a successor job—not just posed panel props.

**S4 — P1, reasoned: an asynchronous preview write can overwrite later progress within the same claim.**

[`noteProgress`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/store/pg-jobs.ts:1953) replaces the entire `steps` array. Its fence checks the **job** and attempt, not the particular step’s status.

For `[simple, sketch]`, the simple step can finish while the job keeps the same running claim. A preview update serialized earlier but delayed in reaching Postgres can then overwrite the cleared preview, restore `simple: running`, or replace newer sketch progress.

The current uncommitted `onLevel` addition calls its observer without awaiting it. `Promise.allSettled` drains the level functions, not promises their observers leave running.

Require awaiting or draining preview writes before step settlement, or use a narrowly fenced preview update. Test deliberately reversed database arrival order. The existing fence **does** reject writes after terminal job completion, lease expiry, release, or a newer attempt; there is also **no lease renewal** in `noteProgress`. Those cases should not be conflated with the same-claim race.

**S5 — P2, established: requeues preserve the previous attempt’s preview.**

[`settledSteps`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/store/pg-jobs.ts:998) retains arbitrary fields while resetting a running step to pending. Both expiry requeue and deadline pause use that transformation. [`runStep`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/jobs.ts:1107) clears `error` at attempt start, but would retain a newly added `preview`.

The same job ID can therefore carry a previous attempt’s Brief into its next attempt. Specify clearing on requeue/start and test that transition. A manual Retry creates fresh steps, so it does not have this particular problem.

**S6 — P2, established: fact 1 incorrectly rules out all mid-run storage.**

A step receives `session.checkpoints` alongside its read-only artifact facade. [`CheckpointStore.write`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/store/checkpoints.ts:304) writes mid-run, and [`pg-session`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/store/pg-session.ts:683) deliberately supplies storage that survives attempt failure.

The accurate claim is narrower: **a step cannot publish its ordinary artifact through that facade before returning**. Fact 2 is correct for the existing `ctx.report` path.

The checkpoint seam does not itself provide a reader-facing preview, so this correction does not invalidate the job-row choice. It does mean retaining Brief after Fuller failure is an existing storage pattern, rather than an architectural escape hatch.

**S7 — P2, established: “live job” understates the preview’s retention and export consequences.**

The owner boundary appears sound:

- Job list/get queries are owner-scoped. `publicJob` forwards `steps`, including a future preview; `/advance` also returns its job. Both are authenticated owner paths.
- Public article DTOs do not contain jobs. I found no admin or fleet view forwarding these application job rows.
- Normal job logs name selected fields rather than serializing steps. The database guard scrubs query parameters before logging; API diagnostics do not send successful response bodies to the ring buffer or Sentry. No established preview leak found.
- Jobs are excluded from offline caching.

However, failed previews remain in jobs until count-based retention removes them—potentially indefinitely for an inactive reader. Dismissal is a soft delete. [`Both article exports exclude jobs`](/home/greg/code/spideryarn2/.claude/worktrees/remove-simple-summary-level/src/store/article-rows.ts:383), so failed Brief text will be readable in the band but absent from the export. State those consequences explicitly; clearing on success does not address them.

For a Metadata rerun, the plan’s “with nothing stored” condition implies keeping the old summary visible until both replacement levels publish. That fits the existing rewrite hold; test it explicitly. Replacing old Brief early would create a mixed-generation display that needs a separate decision.

The smaller viable design remains **Brief on the owner’s job row, ordinary artifact publication unchanged**, with awaited preview delivery and a defined client handoff. Leaving previews on successful jobs until normal retention would simplify clearing, but would still require job-ID selection and completion/failure handling.

**Verdict: refuse on established P1 findings S1–S3.**