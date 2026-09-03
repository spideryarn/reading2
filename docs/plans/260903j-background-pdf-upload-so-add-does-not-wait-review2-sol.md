Not ready. The two landing blockers are that quota recovery is unreachable from the UI and Stop can still produce an ingest.

## Ranked findings

1. Queue-time quota refusal has no usable retry

(a) Mutation:

1. Start with one slot remaining and mint an upload.
2. Consume that slot from another tab while the PUT runs.
3. The engine’s queue POST receives 402 and records `failed { at: "queueing" }`.
4. `worthRetrying()` classifies every quota code as `blocked`, so [AddPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/src/web/AddPage.tsx:531) hides the engine’s Try again button.
5. Upgrade, return to the upload page: nothing re-POSTs. The phase-specific queue retry exists but is unreachable without calling `uploadEngine.retry()` from DevTools. Choosing the file again unnecessarily re-uploads it.

This breaks the stated recovery sequence even well inside the two-hour grant.

(b) Smallest change:

Show the engine retry when `phase.at === "queueing"` and `isQuotaRefusal(phase.reason)`, in addition to ordinary `worthRetrying` failures. That retry already re-POSTs without re-PUTting.

2. Stop is not a reliable terminal state

(a) Mutation 1—queueing:

1. Let the PUT finish, but hold the `/api/jobs` response in flight.
2. Return to the shelf; `busy` includes `queueing`.
3. Press the row’s `x`. [UploadPicker.tsx](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/src/web/UploadPicker.tsx:301) calls `cancel()`.
4. [cancel()](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/src/web/uploadEngine.ts:421) marks the transfer `cancelled`, but the queue request has no abort or rollback. The server may already have created the job.
5. Its reply is fenced at [uploadEngine.ts:290](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/src/web/uploadEngine.ts:290), leaving the client saying cancelled while the normal job poll discovers and drives the ingest.

(a) Mutation 2—late PUT completion:

1. Open the upload address in a second tab while it polls for arrival.
2. Let Storage commit the object, but delay or lose the XHR response.
3. Press Stop in the original tab while it still says `sending`.
4. The original engine becomes `cancelled`; the second tab sees the object and queues it.

The retry design itself acknowledges this ambiguous-completion state. Therefore “cancelled means the object never arrived” is not valid.

(b) Smallest change:

First, make `queueing` non-cancellable: the shelf’s `x` must not call `cancel()` then, and `cancel()` should reject/no-op defensively.

To preserve the stronger claim that Stop means nothing will be added, cancellation needs a durable server transition, racing atomically with `claimUpload`: whichever wins decides whether the upload is cancelled or claimed. Deleting the object is not sufficient because the live grant would be re-armed. Without durable cancellation, the copy must describe Stop as best-effort and must not say “nothing was added.”

3. The manuscript disclosure is false in several ordinary states

(a) Mutation:

- Press Stop halfway through the PUT. `mine.phase.kind` becomes `cancelled`, `stillSending()` becomes false, and the page changes to “The article’s text has been sent to a third-party model provider,” although no job exists.
- Alternatively, open the address in a second tab mid-PUT. `mine` is null, so that tab shows the past tense while simultaneously saying the file is still arriving.
- A queue-time 402 or 503 also becomes `failed`, making the past tense appear even though the provider was never reached.

The problematic predicate is [stillSending()](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/src/web/AddPage.tsx:591): it equates “not currently hashing/granting/sending” with “sent to a model provider.”

(b) Smallest change:

For upload origins, use past tense only after a successful queue outcome exists: an engine `queued`/`article` phase or a page-owned successful POST (`started`/job). Use the present-tense disclosure for `queueing`, waiting, failed, and cancelled states.

4. Overlapping arrival polls can produce two queue POSTs and a false 402

(a) Mutation:

1. Make `GET /api/uploads/:id` take longer than three seconds.
2. Two interval callbacks are now in flight.
3. Have both return `arrived: true`.
4. Each executes `setAttempt(n => n + 1)` at [AddPage.tsx:346](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/src/web/AddPage.tsx:346), producing two POSTs.
5. With one slot remaining, both can observe `pending` before either claim. One reserves and queues; the other reaches serialized admission while the slot is occupied and gets 402. Its later client result can leave the page displaying the quota refusal despite the first request having created the job.

`resolveExistingUpload` closes sequential repeats, not two requests that both read `pending`.

A second concrete mutation is a rolling deployment that changes the wording of `UPLOAD_STILL_ARRIVING`: an already-open client compares the new server sentence against its old bundled sentence and never starts polling.

(b) Smallest change:

On the first `arrived` result, synchronously set `live = false` and clear the interval before incrementing `attempt`, preventing other completed polls from acting. Also classify the failure with `codeOfMessage(reason) === "up-wait"` rather than comparing prose.

5. A refreshed session does not resume the upload’s queue phase

(a) Mutation:

1. Let the PUT finish.
2. Make `/api/jobs` return a final 401.
3. The engine records `failed at queueing` and calls `jobEngine.actionFailed`.
4. Later provide a fresh access token for the same reader.
5. [useJobSession](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/src/web/useJobs.ts:206) resumes only `jobEngine`; the upload remains failed indefinitely if the reader has gone elsewhere.

That leaves the feature dependent on returning to this upload page and manually retrying, despite the previous review explicitly identifying token refresh as an automatic recovery path.

(b) Smallest change:

Retain the queue failure’s HTTP status, add an upload-engine resume operation that retries only a 401-failed queue phase, and invoke it beside `jobEngine.resume()` for a fresh token belonging to the same reader.

6. Stop during hashing/granting does not stop the grant request

(a) Mutation:

1. Choose a large file and press Add.
2. Press the shelf `x` while hashing or the grant POST is pending.
3. `cancel()` has no controller yet; the controller is created only in `sendBytes`.
4. [send()](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/src/web/uploadEngine.ts:400) calls `requestGrant(chosen)` without a signal.
5. Hashing completes and can still send the filename, size, and checksum and create an abandoned upload row after the reader pressed Stop.

The fence prevents the subsequent PUT, but it does not prevent the external mutation.

(b) Smallest change:

Create the controller at the start of `send`, pass its signal to `requestGrant`, and retain it through the PUT. A signal already aborted while hashing will prevent `apiFetch` from dispatching once hashing completes.

7. Present bytes still do not override grant expiry

(a) Mutation:

1. The PUT completes.
2. Queueing receives 402.
3. Upgrade more than two hours later and retry or reload.
4. The route’s HEAD succeeds, but both upload-store adapters still reject the subsequent claim as expired: [filesystem](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/src/store/uploads-fs.ts:79), [Postgres](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/src/store/pg-uploads.ts:141).
5. The already-uploaded file must be selected and uploaded again.

A very slow PUT that starts under a valid grant but finishes after its two-hour boundary reaches the same result.

I cannot produce more than one required re-upload from one occurrence. The additional cost is an orphaned object and record, which currently persist indefinitely. This is therefore a defensible product cut, but it contradicts the revised plan’s stated invariant and its checked test requirement.

(b) Smallest change:

Pass an explicit “Storage readiness already established” option into `claimUpload` and omit the expiry predicate only for that route after a successful HEAD. This needs no persisted `bytesArrived` column. Otherwise revise the plan and add a test pinning the deliberately chosen 410.

## Requested checks that did not produce another finding

- Fence: no stale state write gets through in the requested `retry`/second-`send` interleavings. Retry is a no-op unless already failed, and a second send is synchronously refused. The bad fence case is cancellation during queueing: it suppresses a valid committed reply and creates client/server disagreement.
- Two writers: I found no StrictMode, address-change, or render/effect ordering that makes the mounted page race its own engine. Terminal engine states retain the matching upload ID, so `mine` remains true. Reloads, other tabs, and overlapping arrival polls are real two-writer cases; they are job-idempotent but not harmless at the final quota slot.
- Before unload: no ordinary path leaves the listener registered after terminal state, nor removes it while an uncancelled XHR promise remains. Queueing cancellation removes it while the queue mutation remains active, covered above.
- Ownership: `GET /api/uploads/:id` reads the owner-scoped record before HEAD, so another reader learns only 404.
- HEAD failures: both adapters return null only for genuine absence and throw for other failures, including a Storage 503.
- Pre-existing 409: confirmed from `origin/dev`; claim already preceded enqueue there. The readiness HEAD occurs before the claim and does not widen the claim→enqueue window. More writers can expose the transient `taken/no job yet` response more often, but the unrecoverable state still requires the pre-existing enqueue failure.
- Sweep: deferring it is reasonable for this landing. The old component’s unmount abort already leaked pending records; the new background behavior removes that common source while adding easier explicit cancellation. The net rate is not established, although the leak remains unbounded.

## Test audit

The scoped diff contains three new test files, not four; “upload survives leaving the shelf” is the second case in `add-does-not-wait-for-the-upload.test.tsx`.

Assertions that pass against the old behavior:

- `an-upload-is-queued-…`: “takes it once the object is there,” unknown ID returns 404, and repeat claim still returns the same job after the object is removed. The first is explicitly a control; the latter two test ordering only once HEAD exists.
- `add-does-not-wait-…`: the URL control passes old behavior. In the last-touched case, the final URL navigation and “no grant” assertions also pass old behavior; the new `Add PDF` label assertion is what distinguishes the test.
- The initial “Add is disabled with nothing” assertion passes old behavior; the following enabled-with-PDF assertion is the meaningful one.

Specific ineffective or missing assertions:

- [upload-engine.test.ts:380](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/tests/upload-engine.test.ts:380) does not test its claimed late-success fence: `stop()` makes the posed PUT reject immediately on abort, so the later `resolve()` is a no-op. Removing the stop fence still leaves it green.
- [upload-engine.test.ts:409](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/tests/upload-engine.test.ts:409) is vacuous: `started` is never incremented and `UploadEngineDeps.jobs` does not expose `start`.
- The queue mock always settles immediately, so no test can cancel or stop during `queueing`; that is why finding 2 passes.
- The granting-cancellation test checks fencing but not that the request’s signal was aborted.
- The live queue wiring test records only `"/api/jobs"`. Changing the body at [uploadEngine.ts:496](/home/greg/code/spideryarn2/.claude/worktrees/background-pdf-upload/src/web/uploadEngine.ts:496) to the wrong upload ID would still pass the component and engine tests.
- There is no AddPage test covering arrival polling, disclosure tense, queue-time quota recovery, or Stop.
- The plan’s checked “present object plus expired grant succeeds” test does not exist.

I ran `npx vitest run tests/upload-engine.test.ts`: 19/19 passed.

**Verdict: not ready.**