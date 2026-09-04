## Ranked findings

### 1. A reload, second tab, or cancelled transfer can queue the job before the PDF exists

**(a) Mutation**

1. Choose a large PDF and press Add.
2. While the PUT is still running, copy `/add/upload/<id>` into a second tab—or reload the first tab.
3. That tab has no live singleton, so the planned unchanged [AddPage.tsx](/home/greg/code/spideryarn2/src/web/AddPage.tsx:161) immediately posts `{uploadId}`.
4. [queueAnUpload](/home/greg/code/spideryarn2/src/routes.ts:4634) claims and enqueues without checking Storage.
5. Advance the job before the PUT completes. `acquireUpload` sees a missing or incomplete object and permanently rejects the upload.

The same failure follows Stop → reload: cancellation “posts nothing” only while the singleton remains alive; the reloaded page posts instead.

Atomic `claimUpload` prevents two jobs, but it does not prevent the wrong writer from winning too early. “No server change” therefore does not survive contact.

**(b) Smallest change**

Add a durable server-visible `uploaded`/`ready` state, entered only after Storage confirms the complete object. `/api/jobs` may claim only `ready`; an address opened while still `pending` renders/waits and does not enqueue. This is not the rejected server-side wait: no job, function invocation, or quota slot exists while bytes are moving.

### 2. The final quota gate can strand a fully uploaded file, and duplicate writers can show a false 402

**(a) Mutation**

Quota delay:

1. Start with one quota slot remaining and mint the grant.
2. While the PDF uploads, add a URL in another tab, consuming the slot.
3. Let the PUT finish.
4. The engine’s `/api/jobs` POST gets 402 because [mintAnUpload](/home/greg/code/spideryarn2/src/routes.ts:4588) only asked eligibility; the reservation happens later.
5. Wait until the two-hour grant expires, then upgrade and retry. `claimUpload` now returns expired even though the complete object exists.

The reader sees the refusal on `/add/upload/<id>`, contrary to “every actionable refusal is decided before navigation,” and eventually has no route back to the uploaded bytes.

Two-writer race:

1. Leave exactly one quota slot.
2. Race the engine POST against the second tab’s POST.
3. `withIngestSlot` wraps `queueAnUpload`, so one request reserves before the other reaches the idempotent `taken` branch.
4. The loser gets 402 rather than the winner’s job. Reloading continues to get 402 after the slot is charged.

With two available slots, both may reserve briefly, but the losing reservation is released; there is still only one job, article, and charged slot.

Also, a file named `paper.pdf` containing non-PDF bytes passes the grant route. The real not-a-PDF refusal occurs in `acquireUpload`, not before navigation.

**(b) Smallest change**

Make completed upload readiness durable and independent of grant expiry. Resolve an existing upload’s job/article before quota admission; the transaction that turns a genuinely new ready upload into a job should be the only path that reserves. The upload page must explicitly render queue-time quota and content refusals.

### 3. A failure after `claimUpload` can leave an unrecoverable 409 forever

**(a) Mutation**

Temporarily make `enqueue()` throw after [claimUpload](/home/greg/code/spideryarn2/src/routes.ts:4639) succeeds but before it creates a job. The first POST returns 500. Every later POST finds:

- status `claimed`;
- no job;
- no slug;

and returns 409 at line 4676. `asOf` expires only `pending` records, so waiting past the grant does not recover it. Re-uploading a large file is not “cheap” in the feature specifically motivated by slow uploads.

If the job INSERT committed before the exception, `jobForUpload` can recover it; the broken mutation is the genuine no-job outcome.

**(b) Smallest change**

Give claims an attempt/lease and recover abandoned claims, or atomically combine claim, quota reservation, job creation, and slug recording. A catch-and-release alone does not cover process death between the claim and catch.

### 4. Retry is phase-blind; the measurement proves only the clean partial-abort case

**(a) Mutation**

1. Let the PUT succeed.
2. Make the following `/api/jobs` POST return 503 or a final 401.
3. Press the planned Try again.
4. `retry()` re-PUTs to the same key; Storage returns the measured duplicate 409, so the queue POST is never retried.

A second mutation is a lost PUT response: Storage commits the object, but the browser receives `onerror`. Re-PUT again gets the same duplicate.

The clean “abort at 320 KB leaves no object, then retry returns 200” measurement is real; the suspicion that every grant is burned on first use is not. It simply does not cover ambiguous completion or queue failure.

**(b) Smallest change**

Make retry phase-specific:

- after a known successful PUT, retry only `/api/jobs`;
- after an ambiguous PUT failure, retry PUT and treat duplicate-at-this-staging-key as “bytes already landed,” then queue;
- after grant expiry with no object, mint a fresh attempt.

### 5. The promised early upload ID cannot be implemented without changing `upload.ts`

**(a) Mutation**

Implement the engine while leaving [upload.ts](/home/greg/code/spideryarn2/src/web/upload.ts:212) untouched and call `uploadPdf(file)`. Its promise returns the `Grant` only after `await put(...)`, so `start(file)` cannot resolve the ID while PUT is pending. `put`, `sha256Hex`, `Grant`, and `uploadFailure` are private, so the engine cannot split the operation without duplicating the transport.

The headline test therefore cannot pass under the plan’s stated file boundary.

**(b) Smallest change**

Refactor `upload.ts` without changing transport behavior: expose separate grant and PUT operations, or have `uploadPdf` report the grant through an `onGranted` callback before awaiting PUT. Add `upload.ts` to the planned touched files.

### 6. The upload singleton has no reader/session ownership

**(a) Mutation**

1. Begin an upload.
2. Sign out from `/profile`.
3. When `location.replace("/")` triggers the new `beforeunload` prompt, choose Stay. The Supabase session has already been cleared.
4. The signed Storage PUT can continue, but the eventual queue POST uses whatever session `apiFetch` finds then: none, or a subsequently signed-in reader.
5. It gets 401/404 and the old reader’s filename/transfer remains in the singleton.

A simpler mutation is a final 401 after the PUT, followed by a same-reader token refresh. `jobEngine` resumes; the proposed upload engine has no corresponding signal, so it never performs the pending queue operation automatically.

**(b) Smallest change**

Bind the upload engine to `user.id` with a generation fence. Abort and clear it when the reader changes or signs out; on a fresh token for the same reader, resume only the unfinished queue phase after a final 401.

Deleting the component’s abort-on-unmount is otherwise appropriate: component unmount no longer owns the operation. Its account/session cleanup must move into the service rather than disappear.

### 7. `jobEngine.start()` is the wrong wake-up operation

**(a) Mutation**

Implement the plan literally:

```ts
jobEngine.start();
```

TypeScript rejects it because `start(sessionKey)` requires an argument. Supplying `uploadId` merely to satisfy the type calls `teardown()`, rebinds the engine under the wrong key, and weakens the signed-out/session guarantee.

**(b) Smallest change**

Use `jobEngine.poke()`, which is deliberately a no-op until `App` has bound a signed-in reader. If successful queueing should also clear an auth pause, capture the engine epoch and use a session-fenced “action succeeded” operation rather than calling `start`.

### 8. “Chosen file is the more recent intent” is false

**(a) Mutation**

1. Choose `paper.pdf`.
2. Then type or edit a valid URL.
3. Press Add.

The file still wins although the URL was the more recent action. A `title` is not enough: it is normally invisible on touch, and a drop commits without hovering or pressing Add at all.

**(b) Smallest change**

Make the choice unambiguous: editing the URL clears an uncommitted chosen file, and choosing a file clears the URL. Alternatively track and visibly mark the last-edited source; do not infer recency merely from file presence.

### 9. Stop, Back, and `x` have no coherent terminal-state rule

**(a) Mutation**

1. Start the upload and press Stop on `/add/upload/<id>`.
2. Press Back to the shelf.
3. `chosen` has been lost with the old component mount, while the engine still holds a `cancelled` transfer.
4. Following the plan literally, the shelf’s `x` calls `cancel()` again because a transfer exists; `forget()` is never assigned a UI transition.

If `x` instead forgets the singleton, revisiting the upload address invokes the unchanged AddPage fallback and queues the cancelled upload—finding 1.

**(b) Smallest change**

Specify terminal behavior: Stop produces durable server/client `cancelled`; Back renders that state; `x` on any terminal state calls `forget()`. A cancelled server record must never be eligible for AddPage’s fallback POST.

### 10. `beforeunload` is reasonable, but its proposed boundary is incomplete

**(a) Mutation**

Press Add and close/reload while the engine is hashing or awaiting `POST /api/uploads`. The plan registers the listener only on first `sending`, so there is an active operation but no confirmation; the grant request can even finish after the page begins leaving and create an abandoned record.

There is no inherent false-positive interleaving if registration follows state changes exactly and every terminal transition removes it. SPA navigation and switching tabs do not invoke `beforeunload`, so Greg’s ordinary “go off and do something else” remains intact.

**(b) Smallest change**

Guard every phase whose interruption loses unrecoverable work: granting and sending, and queueing only until durable `ready` recovery exists. Describe the dialog as best-effort protection, not a guarantee that closing the tab is always a choice.

### 11. The stated upload sweep does not exist

**(a) Mutation**

Cancel uploads, wait more than `SWEEP_GRACE_MS`, then list upload rows and `staging/<id>` objects. They remain. `sweepable()` has no production caller; it is referenced only by tests. `asOf()` merely reports an expired pending row without writing or deleting anything.

This does not violate the “never delete while a grant is live” rule in [source.ts](/home/greg/code/spideryarn2/src/source.ts:220); it means cancelled uploads accumulate indefinitely. The plan’s statement that the record “is swept on its grant” is false.

**(b) Smallest change**

Either add and schedule a sweep after the recorded grant expiry plus grace, or state explicitly that cancelled records and staging objects currently leak. Any sweep must preserve claimed records needed for job/article recovery while independently deleting safe staging blobs.

I ran `npx vitest run tests/uploads-api.test.ts`: 15 tests passed and 3 failed before their intended assertions because upload minting returned 500, so that run does not provide clean evidence for the new design.

**Verdict: not ready.**