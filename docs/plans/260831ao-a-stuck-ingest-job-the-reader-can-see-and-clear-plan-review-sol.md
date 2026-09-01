The revised direction is right, but I would not approve the plan unchanged. Stage 1 should be the singleton refactor. The main gaps are completion-event semantics, authentication boundaries, expiry settlement details, and the supposedly small 409 change.

## 1. Singleton or smaller change

Ship the singleton.

Moving only `drive()` is incoherent for exactly Fable’s reason: it still needs job discovery, which creates a second poller. The only credible smaller alternative is a persistent authenticated component that owns one `useJobs()` and exposes its result through context. Once every conditional reading surface subscribes to that context, it is essentially the same refactor with more React involvement.

I would implement:

- `createJobEngine(dependencies)` for isolated tests.
- One exported module-scope `jobEngine` for production.
- A stable external-store snapshot containing at least `jobs`, `loaded`, poll failure, and driver failures.
- `useJobs` subscribing with `useSyncExternalStore`, while retaining per-caller action state such as `lastFailure`.

That is not over-building. It gives the browser worker one real owner, replacing the current module-scope `driving` set and mount-owned poller split in [useJobs.ts](/home/greg/code/spideryarn2/src/web/useJobs.ts:133).

The plan should specify who owns `error`. Today it deliberately conflates poll and action failures, while `lastFailure` survives successful polls ([useJobs.ts](/home/greg/code/spideryarn2/src/web/useJobs.ts:207)). “Actions stay in the hook” does not answer how a successful engine poll interacts with a hook-local action error.

## 2. Singleton versus context

Fable’s conclusion is reasonable; the argument about React is not.

React preserving a component at the same position with the same type and key is contractual behavior, not an accidental gift. `App` could become:

```tsx
if (!user) return ...;
return (
  <JobEngineProvider>
    <AuthenticatedRoutes route={route} user={user} />
  </JobEngineProvider>
);
```

That does not require wrapping every early-return branch individually. The present chain is visible in [App.tsx](/home/greg/code/spideryarn2/src/web/App.tsx:271).

The third option is therefore a persistent `AuthenticatedApp` component that creates an engine instance and exposes it through context. It improves dependency injection and test isolation, but adds a provider whose only real consumer is `useJobs`. I would still choose the module singleton plus factory: the engine is an imperative tab-level service, not React view state.

Unmounting the provider on sign-out would also be desirable, not a failure.

## 3. `onFinished` semantics

The correct meaning is:

> Notify this subscriber once when a job transitions to `done` after that subscriber began observing. Do not announce jobs already done when it arrived.

That means:

- A library or panel mounted after job A finished does not hear A.
- A panel mounted while job B is active hears B once when it finishes.
- A second subscriber mounted after B finished does not hear B.
- Both subscribers hear a later job C.
- A completion between React render and effect subscription must not be lost.

A plain per-subscriber `Set` seeded in `useEffect` is insufficient: the engine can see the completion between render and effect, and the effect may then baseline away real news.

Use a monotonic completion-event sequence in the engine. Each subscriber captures the current sequence during its first render, then consumes events after that cursor. Keep events only long enough for subscribers to consume them.

The pinning test should arrange this exact sequence:

1. Engine snapshot contains historical done A and running B.
2. Subscriber 1 renders and captures its cursor.
3. B becomes done before its subscription effect is flushed.
4. Subscriber 1 receives B exactly once and never A.
5. Subscriber 2 mounts after B is done and receives neither A nor B.
6. C transitions running → done; both receive C exactly once.
7. Repeating an identical done snapshot emits nothing.

This affects `Library.reload` and all current `useStepJob` callers—not only the four named in the plan. The current callers include `useArc`, `useGlossary`, `useIdeas`, `useQuotes`, `useSketch`, `useTimeline`, `useQuiz`, and `Tweets` ([useStepJob.ts](/home/greg/code/spideryarn2/src/web/useStepJob.ts:136)).

## 4. Visibility rules

The hidden `poke` is most likely to be lost. A conventional refactor will put `if (!visible()) return` at the top of polling and accidentally discard the one reconciliation an action requires.

The existing suite proves:

- hidden recurring polls stop;
- driving continues;
- transient advance failures continue retrying;
- becoming visible polls immediately.

It does not prove hidden `poke` ([idle-work.test.ts](/home/greg/code/spideryarn2/tests/idle-work.test.ts:173)).

Add a test that:

1. Starts visible and completes the baseline poll.
2. Hides the document.
3. Performs an action that invokes `poke`.
4. Observes exactly one `GET /api/jobs`.
5. Advances well past `IDLE_MS` and observes no second poll.
6. If that reconciliation discovers a job, observes `/advance` continuing while hidden.

Also retain the “two subscribers produce one poll” test after the refactor.

## 5. `start()`, `stop()`, 401, and sign-out

Starting from the session-owning seam in `App` is correct, but key it deliberately:

- Bind the engine to `user.id`, not merely “truthy user”.
- Use a generation/epoch so responses from before `stop()` cannot update a later session.
- Clear the snapshot, errors, completion history, timers, and visibility listener when identity changes. Public jobs omit `ownerId`, so the engine cannot discover by itself that its cached snapshot belongs to the previous reader.
- Test Strict Mode’s start → stop → start sequence with a deferred old poll.

A 401 needs special handling. `apiFetch` already refreshes and retries once ([api.ts](/home/greg/code/spideryarn2/src/web/lib/api.ts:295)), so the engine should stop only on the final 401. Do not sign the reader out. Pause every poll and drive loop, retain a visible authentication failure, and resume only on a new session/token event, reload, or an explicit successful recovery action.

At present `readJson` throws an ordinary `Error` with no status ([api.ts](/home/greg/code/spideryarn2/src/web/lib/api.ts:181)). The engine therefore cannot safely identify 401 by parsing prose. Inspect the `Response.status` before `readJson`, or introduce a typed HTTP error.

On sign-out:

- Stop scheduling work and generation-fence any in-flight responses.
- Clear the old reader’s snapshot immediately.
- Do not translate sign-out into Stop; the reader did not cancel the job.
- An already admitted `/advance` may finish. Otherwise the durable job remains queued/running and is reconciled when its owner returns or another global advance sweep reaches it.
- The existing sign-out path hard-reloads, so the fetch may also be aborted ([AccountSection.tsx](/home/greg/code/spideryarn2/src/web/AccountSection.tsx:31)).

## 6. Ordering and safe stopping points

The ordering is right.

- After stage 1: navigation no longer strands work. Coherent.
- After stage 2: Stop has correct semantics even though passive list reconciliation is not present yet. Coherent.
- After stage 3: opening a job surface reconciles a dead claimant without pressing Continue. Coherent.
- Stage 4 is an independent UI-policy consolidation.
- Stage 5 builds copy and elapsed-time behavior on that policy.

Stage 3 must follow stage 2. Otherwise a reader who pressed Stop would be passively reconciled to `error`/INTERRUPTED before the cancellation correction landed.

Two stage-2 details are missing before it is a safe stopping point:

- A terminal job must not retain a step with `status: "running"`. Both current expiry implementations leave that possible; the card can therefore show a spinner on a cancelled/error job. Define how the active step settles and assert that no terminal job contains a running step.
- A cancelled settlement must clear stale `error` and `failureKind`, as well as the listed claim/draft fields.

## 7. Stage 3 candidate and cost

Agreed: the application-layer candidate is “any running job.” `Job` cannot inspect leases, and exporting leases to make this gate sharper would violate the design.

I disagree with “costs nothing.” A zero-row indexed update produces no row locks or WAL writes, but it still costs a Vercel→Postgres round trip, pool use, parsing, planning/execution, and index work. At one busy poll per second, it approximately doubles database round trips during a running job.

That may still be the right trade. It is bounded to active periods and buys passive reconciliation. Describe it honestly and measure it.

The existing `jobs_lease_idx` supports the expiry predicate, so I agree that no migration is required.

## 8. Still missing or likely to break

The important omissions are:

- `failExpired` will no longer always fail jobs. Its name, `JobStore` documentation, return type, and the existing log in `advanceJobWith` will become false. Today that log says `failed N job(s)` ([jobs.ts](/home/greg/code/spideryarn2/src/jobs.ts:1159)). Rename the contract to `settleExpired`, or return typed outcomes such as `{ id, status: "error" | "cancelled" }` and use neutral wording.

- Stage 3’s list-triggered settlements need the same ID-bearing warning log as advance-triggered settlements. Otherwise the new common path loses the only server-side account of a dead claimant.

- The plan promises database time, but Postgres currently creates and compares lease times using application `Date.now()`/`new Date()` ([pg-jobs.ts](/home/greg/code/spideryarn2/src/store/pg-jobs.ts:427)). Since this work is already touching claim expiry, use database `now()` for production claim creation, expiry comparison, and `finishedAt`; retain injected dates only for tests.

- “Interrupted” is not derivable from `failureKind: "retry"`; many failures are retryable. Stage 4 must name the exact classifier, probably the canonical `[jb-gone]`/`INTERRUPTED` identity.

- `slow` is not derivable from `Job` alone without a clock and an explicit threshold. Make the mapper pure as `displayJob(job, now)` and decide whether thresholds are global or step-specific. Test malformed and future `startedAt` values.

- Consecutive advance failures are client state not present in `Job`. The engine snapshot needs a per-job health map, an exact threshold, reset-on-success semantics, and cleanup when jobs disappear or finish. Stage 4’s “one place says state” must either accept this health input or explicitly keep transport health separate.

- The 409 work is substantially underdesigned. `enqueue` has the blocking `job` available ([jobs.ts](/home/greg/code/spideryarn2/src/jobs.ts:1749)), but the generic route handler emits only `{ error }` ([routes.ts](/home/greg/code/spideryarn2/src/routes.ts:4697)); `readJson` discards structured failure fields; and `useStepJob` filters jobs to those writing the requested step ([useStepJob.ts](/home/greg/code/spideryarn2/src/web/useStepJob.ts:145)). Returning an id alone will not make the blocking job appear in `JobProgress`. Specify the structured 409 response, typed client result, `StepJob` state, and how `JobProgress` renders a blocker whose steps do not include the requested step.

- Existing tests that assume mounting `useJobs` starts polling will break, especially [idle-work.test.ts](/home/greg/code/spideryarn2/tests/idle-work.test.ts:105) and [refused-job-reason-survives.test.tsx](/home/greg/code/spideryarn2/tests/refused-job-reason-survives.test.tsx:12). Anonymous-network coverage must also continue proving a shared signed-out reading page never calls `/api/jobs`.

My verdict: ship the singleton design, not the incremental driver move and not necessarily a provider. Revise the plan first around the completion cursor, session generation/reset, typed expiry outcomes, terminal step normalization, and the full 409 data path. Those are correctness questions, not implementation polish.