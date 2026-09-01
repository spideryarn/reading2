# Review the built code for Stage 1 — the job engine

You reviewed the plan for this work and your findings shaped it. **Stage 1 is now built and
committed.** This is a review of code, so weight it higher than a plan review: check what the code
actually does, what the tests actually pin, and what a concurrent second actor can make happen.

## The correction that came out of building it — read this first

The plan's headline diagnosis was **wrong**, and the implementer found it. The plan said `useJobs`
is mounted only in `Library.tsx`, `AddPage.tsx` and `useStepJob`, and that since `App()` is a chain
of early returns, clicking from the shelf into an article unmounts the only thing calling
`/advance`. In fact **`useArc` runs on every owned reading view** (`App.tsx`) and goes through
`useStepJob` → `useJobs`, so the reading view mounts a poller of its own and picks the job back up
within a second. What genuinely stopped were the routes that mount none: `/profile`, `/design`,
`/admin`, the landing page.

The justification that survives, and the one to judge this refactor against: **whether an ingest
kept running depended on whether the page you happened to open happened to mount an unrelated hook**
— `useArc`, which exists for the arc feature and knows nothing about the queue. Driving was working
by accident. Tell me if you think that is still enough to justify what was built, or whether a
smaller change was right given the corrected diagnosis.

## What was built

- **`src/web/jobEngine.ts` (new)** — `createJobEngine(deps)` plus an exported `jobEngine` singleton.
  Owns the poll timer, the jobs snapshot, the visibility rules and one `drive()` loop per job. Deps
  are `listJobs`, `advance`, `visible`, `watchVisibility`, so engine tests run with no network and no
  `document`. Snapshot: `jobs`, `loaded`, `error`, `driverFailures`, `authFailed`.
- **`src/web/useJobs.ts`** — rewritten as a `useSyncExternalStore` subscriber plus the actions.
  Signature and every field name unchanged; `lastFailure` stayed a per-subscriber ref;
  `error`/`loaded`/`jobs` became engine state.
- **`src/web/lib/api.ts`** — new `HttpError` thrown by `errorFor`, so `readJson` and `failure` carry
  a status, plus `statusOf(err)`. **Duck-typed, not `instanceof`** — a test that mocks `lib/api.js`
  supplies its own `readJson`, and a second copy of the class in the graph would make `instanceof`
  false for an object that is one in every way that matters.
- **`src/web/App.tsx`** — a `useEffect` keyed on `user?.id ?? null` calling `jobEngine.start(id)`
  with `stop()` as cleanup, above the early-return chain.
- **`src/web/useStepJob.ts`** — a stale comment fixed (it said four consumers; there are eight).

## Four decisions the implementer flagged for a reviewer

1. **`receive(jobs)` is public API on the engine.** The window under test is one synchronous commit,
   so nothing that goes through a promise can land inside it — no fake server can reach step 3 of
   your seven-step completion sequence. `receive` is the engine's own reducer, exposed. Without it
   that invariant is untestable. Is exposing a reducer to make an invariant testable the right
   trade, or is there a way to reach that window without widening the API?
2. **The engine is awake when `started || subscribers > 0`, not on `started` alone.** Otherwise
   mounting `useJobs` where `start()` has not run polls nothing, and four existing test files do
   exactly that. Does that weaken the signed-out-visitor guarantee in any path? The claim is that it
   does not, because nothing mounts `useJobs` for a visitor.
3. **Completion events are capped at 200, not pruned by cursor.** A subscriber captures its cursor
   at *render*, before the engine knows it exists, so "prune below the lowest cursor anybody holds"
   would drop precisely the event of the subscriber it cannot see. Overflow therefore loses an
   announcement rather than duplicating one. Is that the right failure direction, and is 200 the
   right number, and what happens to a tab left open for a week?
4. **Opening a band costs one extra poll** (session poll → sleep → subscriber wakes it). Avoidable
   with a "last polled at" clock; not done, because before this every mount had its own poller.

## The questions

1. **Are your five plan-review findings actually implemented, or merely named?** Specifically: the
   completion cursor captured at render; generation fencing on `user.id`; the final-401 rule; the
   hidden `poke` making exactly one request; sign-out not being Stop. Check each in the code, not in
   the comments.
2. **The eleven invariants that were bugs first** (they are listed in `useJobs.ts`'s history and in
   the plan). Which, if any, were silently lost in the move? Name the file and line.
3. **`useSyncExternalStore` correctness.** Is the snapshot stable enough — does `getSnapshot` ever
   return a fresh object and cause an infinite render loop? Is `getServerSnapshot` needed here?
4. **Teardown.** Does `stop()` actually clear every timer, listener, in-flight generation and drive
   loop? Is there a path where a drive loop outlives the session that started it and writes into a
   later one?
5. **The `HttpError` duck-typing.** Sound, or does it swallow a real error shape? Does anything now
   depend on `readJson` throwing a plain `Error`?
6. **Do the four new tests pin what they claim?** The implementer says each was watched red by a
   specific weakening, listed in the plan. Name any that would pass against a broken implementation.
7. **What did Stage 1 break or make harder for Stages 3–6?** Stage 3 adds owner-scoped
   `settleExpired` called from `listJobs()`; Stage 5 wants per-job advance-failure health in the
   snapshot (`driverFailures` exists already — is its shape right?).
8. **Anything a code review can see that a plan review could not.**

## Facts

- Production is Vercel, no cron; `pump()` returns early on `VERCEL`, so the browser is the only
  driver.
- `useJobs(onFinished?) => UseJobs` had to keep its exact signature: five test files `vi.mock` the
  whole hook and are the proof the external contract survived.
- Tests rewritten rather than re-run: `idle-work.test.ts` (needed `statusOf` in its mock and a
  per-test `jobEngine.reset()`; every assertion survived unchanged), `refused-job-reason-survives`
  and `sketch-view-drawing` (reset only), `public-network-trace` (the owner half changed — any
  signed-in reader now makes one `GET /api/jobs`; the signed-out-visitor half is untouched, green,
  and non-negotiable).
- Several agents share this tree; `App.tsx` and `public-network-trace.test.tsx` also carry a peer's
  Review→Remember rename. Ignore those hunks.

The commit is `2a0ae3d`. The plan is
`docs/plans/260831ao-a-stuck-ingest-job-the-reader-can-see-and-clear.md`. Read
`src/web/jobEngine.ts`, `src/web/useJobs.ts`, `src/web/lib/api.ts`, `src/web/App.tsx`,
`src/web/useStepJob.ts` and the four `tests/job-engine-*.test.ts*` files directly from the
repository — they are committed, so you can read them at HEAD rather than from a diff.
