I would request changes before calling Stage 1 complete. The singleton engine is still justified after the corrected diagnosis—the browser is the production worker, so its driver should not depend on an unrelated feature hook—but three session/concurrency holes remain.

## Findings

1. High — an old drive loop can remove the new session’s ownership marker.

Teardown clears `driving`, allowing the restarted session to drive the same durable job. When the old loop eventually exits, its unconditional `finally` deletes that new marker: [jobEngine.ts:483](/home/greg/code/spideryarn2/src/web/jobEngine.ts:483), [jobEngine.ts:495](/home/greg/code/spideryarn2/src/web/jobEngine.ts:495), [jobEngine.ts:506](/home/greg/code/spideryarn2/src/web/jobEngine.ts:506).

A later poll can then start a second current-generation loop for that job. The server lease prevents two writers, but the “one drive loop per job” invariant is false, requests are duplicated, and `driverFailures` becomes misleading.

Use a per-loop token, for example `Map<id, token>`, and delete only if the map still contains that loop’s token. Add a deferred-`advance` stop→start test; the current session test defers only a poll.

2. High — hook actions are not generation-fenced.

An action started by reader A can resolve after reader B’s engine has started. Its continuation calls the current singleton’s `actionSucceeded` or `actionFailed`: [useJobs.ts:182](/home/greg/code/spideryarn2/src/web/useJobs.ts:182), [useJobs.ts:186](/home/greg/code/spideryarn2/src/web/useJobs.ts:186), [useJobs.ts:190](/home/greg/code/spideryarn2/src/web/useJobs.ts:190). Those methods blindly clear/set B’s error and authentication state and poke B’s queue: [jobEngine.ts:570](/home/greg/code/spideryarn2/src/web/jobEngine.ts:570).

So “a response in flight before stop cannot write into the later session” is implemented for polls and advances, but not actions. Capture an engine epoch when the action starts and ignore its engine-state side effects if that epoch is stale.

3. High — the final-401 rule is only partly implemented.

The good half is real: `apiFetch` refreshes and retries before `readJson` exposes the final status, and poll/advance errors inspect that status.

Three holes remain:

- If `again` was set while the failing poll was in flight, `finally` starts another poll despite `authFailed`: [jobEngine.ts:403](/home/greg/code/spideryarn2/src/web/jobEngine.ts:403). `poll()` itself has no auth guard. If that extra poll succeeds, it clears `error` while leaving `authFailed=true`, producing a silent paused engine.
- A later Supabase token event for the same reader does not resume it. `useSession` receives every event at [useSession.ts:85](/home/greg/code/spideryarn2/src/web/useSession.ts:85), but App’s effect depends only on the unchanged reader id: [App.tsx:255](/home/greg/code/spideryarn2/src/web/App.tsx:255).
- An action’s `HttpError.status` is discarded when `act` passes only its message to `actionFailed`.

There is no engine-level 401 test covering pause, no extra request, visible error, same-user token recovery, and successful-action recovery.

4. Medium — `started || subscribers > 0` weakens the lifecycle contract.

At [jobEngine.ts:250](/home/greg/code/spideryarn2/src/web/jobEngine.ts:250), a subscriber can run the engine with no authenticated session binding. No current visitor route mounts `useJobs`, so the signed-out network test remains true today. Structurally, though, the engine no longer enforces it; it relies on every future visitor component preserving that topology.

It also means `stop()` does not necessarily remove the visibility listener or make later action pokes inert while a subscriber remains.

I would make `started` the authority and update the four old hook tests to call `start()`. Test compatibility should not define production authentication semantics.

5. Low — the disproved diagnosis remains asserted in the built source and tests.

The false shelf→reading-view story is still presented as fact in [jobEngine.ts:7](/home/greg/code/spideryarn2/src/web/jobEngine.ts:7), [useJobs.ts:5](/home/greg/code/spideryarn2/src/web/useJobs.ts:5), [App.tsx:241](/home/greg/code/spideryarn2/src/web/App.tsx:241), and [job-engine-drives-with-no-view.test.ts:4](/home/greg/code/spideryarn2/tests/job-engine-drives-with-no-view.test.ts:4). This is especially worth correcting because the stale mount accounting already caused the original misdiagnosis.

## Direct answers

- Completion cursor: correctly captured during first render and the seven-step behavioral test is convincing.
- Generation fencing: correct for poll and advance results; incomplete for actions and drive ownership bookkeeping.
- Final 401: final-response detection works; pause/recovery has the defects above.
- Hidden poke: the main exactly-one-request behavior is implemented correctly.
- Sign-out is not job cancellation: correct. No durable cancel is sent, and an admitted advance may finish.

Of the legacy invariants, the behavior silently lost is “one drive loop per job,” specifically across teardown/restart at `jobEngine.ts:495/506`. Hidden polling, hidden driving, hidden poke, immediate visible reconciliation, advance retry, first-list baselining, active-job resumption, serialized polling, `sameJobs`, and per-subscriber `lastFailure` remain in the ordinary same-session path.

`useSyncExternalStore` is correct for the current client-only app. `getSnapshot` returns one stable object until state changes; identical job lists preserve the array and `set` bails out. No `getServerSnapshot` is needed without SSR or hydration.

`HttpError` duck typing is sound at this seam. Only `listJobs` and `advance` errors are classified, so a numeric `status` genuinely means HTTP status. I found no consumer depending on the exact plain-`Error` constructor; `HttpError` is still an `Error`. Its new status behavior should nevertheless have a direct test—[web-api.test.ts:42](/home/greg/code/spideryarn2/tests/web-api.test.ts:42) currently checks only messages.

The four test files do not fully pin their prose:

- Completion behavior is pinned, but the repeated-list assertion would still pass if `sameJobs` were removed.
- No-view driving is pinned, but not the stale-drive `finally` race.
- Hidden poke is pinned; the “reader comes back” case manually calls `poke()` and would pass if `watchVisibility` were broken.
- Session polling is fenced, but actions and advances are not exercised. The Strict Mode test copies App’s effect rather than importing App, so App could drift while it stays green.
- There is no explicit two-subscriber poll-count test despite the plan saying to keep one.

For later stages:

- Stage 3’s `listJobs()` seam remains suitable for owner-scoped `settleExpired`; account for both the session poll and band-open poll when measuring its database cost.
- `driverFailures: Readonly<Record<id, count>>` is a reasonable Stage 5 shape, but it is not exposed through `UseJobs` yet. Fix duplicate drive loops first or the count cannot be trusted.
- Stage 6 is unchanged conceptually: `HttpError` still discards structured 409 fields, so it must grow typed details or that path must bypass ordinary `readJson`.

I approve `receive` as a pragmatic synchronous test seam, the 200-event cap, and the extra band-open poll. Normal subscribers drain on each commit, so a week-open tab does not inherently lose events; overflow requires more than 200 completions before a subscriber can commit. The cap’s failure direction is acceptable for that extreme case.

Checks: the root and web TypeScript projects pass direct `tsc --noEmit`. The tests project has three unrelated current-tree type errors. Vitest could not collect under this read-only environment because Vite/jsdom attempted to create temporary directories.