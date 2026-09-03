# Background PDF upload, so Add does not wait for the bytes

**Status as of 2026-09-03: built and green, not yet reviewed as code, not yet seen in a browser** —
evidence: `src/web/uploadEngine.ts` exists and `tests/upload-engine.test.ts`,
`tests/add-does-not-wait-for-the-upload.test.tsx` and
`tests/an-upload-is-queued-only-once-its-bytes-arrive.test.ts` are green, as is
`npm run typecheck`; the last two stages below are unticked.

The review is at
[260903j-…-review-sol.md](260903j-background-pdf-upload-so-add-does-not-wait-review-sol.md); its
verdict on the first draft was **not ready**, and it was right on all eleven counts I checked. What
follows is the plan after it. § *What the review changed* says which of them moved what.

## The problem

> When I upload a PDF to the add section of the Home page, sometimes it takes a while to upload over
> a slow connection. I have to wait before I can then click the Add button, because that's disabled
> in the meantime. I'd like to be able to upload and then click Add immediately, which would then
> wait for the upload to finish and run the ingestion queue immediately, so I could go off and do
> something else in the meantime.
>
> — Greg, 2026-09-03

Today the shelf makes the reader watch a progress bar and then navigates. Three things are wrong
with that on a slow connection:

1. **The commit gesture is at the end of the wait rather than the start.** Choosing a file shows a
   *Send it* button; pressing it replaces the button with a bar; the address `/add/upload/<id>` only
   appears when the last byte has gone.
2. **The transfer dies if the reader goes anywhere.** `UploadPicker` aborts on unmount
   ([`src/web/UploadPicker.tsx`](../../src/web/UploadPicker.tsx), the `useEffect` cleanup), and that
   is deliberate — today a completed transfer *navigates*, so it must not fire at somebody who has
   left. But it also means typing a URL and pressing Add, or clicking through to any other page,
   silently throws away a 40 MB upload that was nearly done.
3. **There is nothing to look at.** The transfer has no address, so a reader who does leave has no
   way back to it and no way to know it is gone.

## The shape of the fix

**The transfer becomes a tab-level service that owns the whole of "get this file into an article"**
— the PUT *and* the `POST /api/jobs` that follows it — instead of a piece of one component's state.
The address is minted first, so Add can navigate immediately.

```
  Add pressed
    │
    ├─ POST /api/uploads   {filename, bytes, sha256}   awaited: ~200 bytes, one round trip
    │      └─ refusals decidable before any bytes move (quota today, wrong name, too large)
    │
    ├─ navigate("/add/upload/<id>")     ← immediately, with 0 bytes sent
    │
    └─ uploadEngine, in the background, wherever the reader goes next:
          PUT <signed url>   the whole file
          POST /api/jobs     {uploadId}
             └─ server HEADs the staging object first: no object, no job   ← the readiness gate
          → jobEngine picks the job up and drives it
```

The grant POST stays awaited because it is the thing that produces the address, it is small, and it
is where the refusals that can be decided up front are decided. Everything after it is background.

### The readiness gate is what makes the address safe to hand out early

This is the review's first finding and the one that reshaped the plan. Today `/add/upload/<id>`
cannot exist until the bytes have landed, so `queueAnUpload` never has to ask whether they did. The
moment the address exists from byte zero, three ordinary things queue a job over a file that is not
there — **reload the tab**, **open the address in a second tab**, **press Stop and then reload** —
and `acquireUpload` answers each of them with `refuse("missing")`, which is terminal. The reader's
upload is destroyed by their own reload.

So `POST /api/jobs {uploadId}` gains one question, asked before anything else happens:

```ts
const there = await blobStore().head(stagingKey(uploadId));
```

- **No object** → `409`, with a distinct reason meaning *the bytes have not arrived yet*. Nothing is
  claimed, nothing is enqueued, **and no quota slot is reserved**.
- **An object** → carry on, **whatever the grant's expiry says**. The grant's expiry exists to stop
  us claiming an upload whose bytes never came; a `head` that succeeds has answered that question
  from the authoritative place, so the expiry has nothing left to protect.

**The object's own existence is the readiness state.** The review asked for a durable `ready` column
entered after Storage confirms the object; this is the same fact read from the place that cannot
disagree with itself, and it needs no migration and no second writer. It is a true test of
completeness rather than a proxy, and that is measured, not assumed — see the table under
§ *Principles*: an aborted PUT leaves no object at all.

That one gate closes finding 1 outright, and it closes the half of finding 2 where a reader who
upgrades after a 402 finds their uploaded bytes unreachable because the grant has since expired.

### Why an engine and not the page

Exactly the argument [`src/web/jobEngine.ts`](../../src/web/jobEngine.ts) already makes for itself,
one step earlier in the chain. If `/add/upload/<id>` owned the wait, then "go off and do something
else" would unmount the only thing that was ever going to POST `/api/jobs` — the ingest would never
start, which is precisely the request. A background worker with a transfer in flight is not view
state, so it does not belong to a mount.

`createUploadEngine(deps)` + a module singleton, mirroring `createJobEngine`, so the tests can drive
it with no React at all — the same thing that makes
[`tests/job-engine-drives-with-no-view.test.ts`](../../tests/job-engine-drives-with-no-view.test.ts)
mean something.

**It is bound to a reader, exactly as the job engine is.** `useJobSession(readerId, accessToken)`
([`src/web/useJobs.ts`](../../src/web/useJobs.ts)) is the one seam that knows who is signed in, and
it gains `uploadEngine.start(readerId)` / `stop()` beside the two calls already there. Without that,
signing out mid-transfer leaves one reader's filename and bytes in a singleton that then posts
`/api/jobs` as whoever is signed in next (review finding 6).

**And it reports through `jobEngine`'s action seam rather than waking it.** The engine captures
`jobEngine.epoch()` before its `POST /api/jobs` and hands the outcome back through
`actionSucceeded(epoch)` / `actionFailed(message, status, epoch)`. That pokes the poller, lifts an
authentication pause on success, and starts one on a 401 — all of it session-fenced. `start()` is
not the operation to use here: it takes a session key, and calling it with anything else tears the
engine down and rebinds it under a wrong key (finding 7).

### One button, and it is Add

Greg chose this over keeping *Send it* (2026-09-03):

```
  [ example.com/an-essay-worth-reading   ] [ PDF ] [ Add PDF ]

    paper.pdf                        2.1 MB of 11 MB   [x]
    ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░
```

- Add is enabled when there is a valid URL **or** a chosen file.
- **The last-touched source wins**, tracked explicitly, and the button's **label** says which — *Add*
  for the URL, *Add PDF* for the file. The first draft said "a chosen file wins, and the button's
  `title` explains it", and the review was right that this is false twice over: typing a URL *after*
  choosing a file is the more recent intent, and a `title` is invisible on touch.
- *Send it* is deleted. Dropping a file is still the commit gesture on its own (unchanged, and for
  the reason in `UploadPicker`'s header: a target that catches a file and then waits is
  indistinguishable from one that swallowed it). A drop also sets last-touched to the file, which is
  automatic, because it commits in the same gesture.
- The file picker keeps its two gestures — choose, then Add — which is the safeguard the *Send it*
  button existed for.

### What this does not fix, and must say so

**Closing the tab still loses the upload.** The bytes exist only in the browser until they reach
Storage; there is no server-side copy to resume from and no way to make one without routing 50 MB
through a Vercel function that refuses bodies over 4.5 MB. So:

- a `beforeunload` guard for **every phase whose interruption loses unrecoverable work** — hashing,
  granting, sending, and queueing — registered on entering the first and removed on every terminal
  state. Best-effort, not a guarantee: the browser may decline to show it.
- a sentence on `/add/upload/<id>` while sending, in the shape of `KEEP_A_TAB_OPEN`
  ([`src/job-state.ts`](../../src/job-state.ts)) but about the file rather than the ingest.

Switching tabs, navigating anywhere in the app, and locking the phone are all fine —
`beforeunload` does not fire for an SPA navigation.

**Two refusals still land after the transfer, and they are honest ones.**

- **Quota.** `POST /api/uploads` asks (`refuseUploadWithoutQuota`, non-reserving) and
  `POST /api/jobs` is the gate that reserves — that split is deliberate
  ([`src/billing/admission.ts`](../../src/billing/admission.ts)) and is not this plan's to move.
  Today those two moments are a second apart; here they can be twenty minutes apart, so a reader who
  spends their last slot in another tab meanwhile is refused *after* uploading. It lands on
  `/add/upload/<id>` with the `QuotaNotice` link to `/profile`, and — because of the readiness
  gate — the bytes stay claimable for as long as the object is there, so upgrading and pressing
  *Try again* works.
- **The bytes are not a PDF.** `POST /api/uploads` reads a *name*; the `%PDF-` check is over the
  bytes in `acquireUpload` and always has been. The first draft claimed every actionable refusal was
  decided before the navigation, and that was never true — `paper.pdf` full of ZIP passes the door
  today too.

**Abandoned and cancelled uploads accumulate.** `sweepable()` in
[`src/source.ts`](../../src/source.ts) has **no production caller** — only its own definition and
`tests/source.test.ts` — so nothing deletes an expired `pending` record or its staging object. The
first draft said a cancelled transfer's record "is swept on its grant", and that was simply false.
Cancelling gets easier and more likely under this plan, so the leak gets larger; it is stated here
rather than fixed, and a sweep, when somebody writes one, must not delete an object whose record can
still be claimed under the readiness gate.

## The simpler options passed over

- **Leave the transfer in `UploadPicker` and merely navigate early.** Fails immediately: the
  component unmounts on the navigation, so either the abort-on-unmount kills the upload or removing
  it leaves an orphaned XHR whose completion nothing is listening for.
- **Hoist the transfer but let `/add/upload/<id>` own the `POST /api/jobs`.** Cheaper, and it breaks
  the actual request — leave that page and nothing queues the ingest.
- **No server change at all.** This was the first draft's claim and it did not survive contact: an
  address handed out before the bytes exist needs the server to know the bytes do not exist yet. One
  `head`, and a reordering so that an upload's existing job is found before a quota slot is taken.
- **Leave `src/web/upload.ts` untouched.** Also the first draft, also wrong: `uploadPdf` resolves its
  `Grant` only after `await put(...)`, and `put`, `sha256Hex` and `Grant` are all private, so the
  headline behaviour is unimplementable without splitting that module's *exports*. Its transport
  behaviour is still not being changed.
- **Wait on the server: enqueue at once and let the `fetch` step poll Storage for the object.** This
  is the version that would survive a closed tab, and it is much worse. It needs a new job state, a
  step that blocks for minutes inside a serverless invocation with a wall-clock limit, a quota slot
  held open the whole time, and a stuck job whenever the bytes never come. Worth revisiting only if
  uploads ever get a resumable server-side path.
- **Allow several transfers at once.** Deferred, deliberately. The engine refuses a second file
  while one is in flight, with a sentence, exactly as `take()` does today. A serial queue is a small
  extension (an array and a "start the next one" line) and can be added the day somebody wants it;
  parallel PUTs over the connection this feature exists for would help nobody.

## References

- [`src/web/UploadPicker.tsx`](../../src/web/UploadPicker.tsx) — the component being gutted: `take`,
  `send`, the abort-on-unmount cleanup, the drag counter, the progress row.
- [`src/web/upload.ts`](../../src/web/upload.ts) — `uploadPdf`, `put`, `sha256Hex`, `realStatus`,
  `uploadFailure`. The transport is unchanged; the exports are split.
- [`src/web/jobEngine.ts`](../../src/web/jobEngine.ts) — the pattern to copy: `createJobEngine`,
  `start(sessionKey)`/`stop()`, `epoch()`, `actionSucceeded`/`actionFailed`, `poke()`, `reset()`.
- [`src/web/useJobs.ts`](../../src/web/useJobs.ts) § `useJobSession` — the one place that knows who is
  signed in, and where the upload engine gets bound and torn down.
- [`src/web/AddArticle.tsx`](../../src/web/AddArticle.tsx) — the add row, `submit`, the Add button's
  `disabled={!slug}`, and where `uploadStatus` is placed.
- [`src/web/AddPage.tsx`](../../src/web/AddPage.tsx) — `/add/upload/<id>`: the post-once ref, the
  `article` outcome, `failure` vs `queue.error`, `JobCard`, `KEEP_A_TAB_OPEN`.
- [`src/routes.ts`](../../src/routes.ts) — `mintAnUpload`, `queueAnUpload`, `jobForUpload`,
  `publicUpload`, and the `withIngestSlot` wrapper at the `POST /api/jobs {uploadId}` branch.
- [`src/billing/admission.ts`](../../src/billing/admission.ts) — `withIngestSlot`, `admitIngest`,
  `refuseUploadWithoutQuota`. `admitIngest` throws **before** the callback runs, which is why an
  upload's existing job has to be found before admission rather than inside it.
- [`src/pipeline.ts`](../../src/pipeline.ts) § `acquireUpload` — `refuse("missing")`, the terminal
  answer the readiness gate exists to keep out of reach.
- [`src/source.ts`](../../src/source.ts) — `stagingKey`, `grantExpired`, `sweepable` (uncalled).
- [`docs/project/ingest-queue.md` § Uploading a PDF](../project/ingest-queue.md#uploading-a-pdf) —
  the evergreen doc this work contradicts in one paragraph ("Only when the bytes have landed does
  the reader go to `/add/upload/<uploadId>`"), which must be rewritten in the same piece of work.
- [`docs/plans/260826u-pdf-upload-and-storage.md`](260826u-pdf-upload-and-storage.md) — the original
  design, the measurements, and the two cross-family reviews.
- [`docs/project/billing.md`](../project/billing.md) — what a slot is and when it is spent.
- [`docs/project/copy.md`](../project/copy.md) — the rules for the new sentences.
- [`docs/reusable/silent-success.md`](../reusable/silent-success.md) — the failure mode this whole
  area keeps producing; a background transfer is a fresh opportunity for it.

## Principles and key decisions

- **The bytes' existence is the readiness state, and it gates everything.** One `head`, at the top of
  `queueAnUpload`, before the claim and before the slot. No new column, so there is no second writer
  to disagree with Storage.
- **A grant's expiry stops mattering once the object is there.** It protects against claiming an
  upload that never arrived; the `head` answers that better.
- **An upload's existing job or article is resolved before admission.** `withIngestSlot` wraps
  `queueAnUpload` today (`src/routes.ts`, the `{uploadId}` branch), and `admitIngest` throws 402
  before the callback runs — so with one slot left, two requests for the *same* upload can give the
  loser a 402 instead of the winner's job. Splitting a slot-free `resolveExistingUpload` out in front
  fixes it, and costs one read.
- **The engine owns the POST, and the page renders what it did.** One writer, so "add", "reload the
  page", and "open it in a second tab" cannot become two ingests. The page keeps a fallback POST for
  the one case the engine cannot cover — an address opened with no live transfer behind it — and the
  readiness gate is what makes that fallback safe.
- **Retry is phase-specific.** The engine knows which phase failed and retries only that:
  - failed **queueing** (a 503, a lost 402 that has since been fixed by upgrading) → re-POST
    `/api/jobs` only. Never re-PUT: the object is there, and a re-PUT is a guaranteed duplicate that
    would strand the retry short of the thing that actually failed.
  - failed **sending** → re-PUT, and treat a duplicate at *our own* staging key as *the bytes landed*
    rather than as a refusal, then go on to queueing. This is the ambiguous-completion case: Storage
    committed the object and the browser saw `onerror`.
  - failed **granting** → there is nothing to retry from, and it happens on the shelf before any
    navigation, so it is the existing refusal on the existing screen.
- **The transport is not touched.** `put`, `realStatus` and `uploadFailure` in `src/web/upload.ts`
  carry a lot of hard-won detail (`onload` fires for a 4xx; a duplicate arrives as HTTP 400 saying
  409). They are re-exported, not rewritten. `put` gains the real status on the error it throws, so
  the engine can tell a duplicate from a refusal without parsing a sentence.
- **The `File` stays in memory for the life of the transfer, and nowhere else.** No IndexedDB, no
  attempt at resumption across a reload — see *What this does not fix*.
- **`chosen` stays component state; the transfer does not.** A file picked and not yet committed
  should die when you leave the shelf. A file being sent should not.
- **Retry re-PUTs the same `File` to the same grant, and that is measured rather than assumed.**
  A signed upload grant is **not single-use**: it is a JWT carrying `{url, upsert:false,
  scope:"upload", exp}` with `exp` two hours out (`GRANT_SECONDS`,
  [`src/store/blobs-supabase.ts`](../../src/store/blobs-supabase.ts)), so what a second PUT hits is
  the *object*, not a spent token. Measured against the local Supabase stack on 2026-09-03
  (storage-api at `127.0.0.1:54361`, bucket `sources`):

  | sequence | result |
  | --- | --- |
  | sign → PUT | `200` |
  | → PUT again, same token | `400` body `{"statusCode":"409","error":"Duplicate"}` |
  | sign → PUT aborted at 320 KB of 5 MB | **no object at all** (`HEAD` → not found) |
  | → PUT again in full, same token | `200` |

  Two things rest on that third row: retry after a partial failure works, and **a `head` on the
  staging key is a true test of a completed upload** rather than a proxy for one. `realStatus` in
  `src/web/upload.ts` is what turns the `400` into a `409`, which is the scar from the last time
  this pair was reasoned about instead of run.

## What the review changed

| finding | verdict | what changed |
| --- | --- | --- |
| 1 · a reload or second tab queues before the bytes exist | **confirmed, and it destroys the upload** | the readiness gate; the fallback POST now waits |
| 2 · quota decided after the transfer; 402 race | **confirmed** (`admitIngest` throws before the callback) | `resolveExistingUpload` before admission; gate makes bytes stay claimable past expiry; the "every refusal before navigation" claim withdrawn |
| 3 · unrecoverable 409 if `enqueue` throws after the claim | **confirmed, and pre-existing** | its own stage at the end, flagged to Greg rather than smuggled in |
| 4 · retry is phase-blind | **confirmed** | phase-specific retry; duplicate-at-our-key means the bytes landed |
| 5 · the early upload id needs `upload.ts` split | **confirmed** | "transport untouched" narrowed to *behaviour* untouched; exports split |
| 6 · no reader/session ownership | **confirmed** | bound in `useJobSession`, torn down on sign-out |
| 7 · `jobEngine.start()` is the wrong operation | **confirmed** (`start(sessionKey: string)`) | `epoch()` + `actionSucceeded`/`actionFailed`, never `start` |
| 8 · "chosen file is the more recent intent" is false | **confirmed** | last-touched wins, and the button's label says which |
| 9 · Stop / Back / `x` have no terminal rule | **confirmed** | terminal states specified; the gate makes a cancelled upload unqueueable |
| 10 · `beforeunload` boundary too narrow | **confirmed** | guards hashing, granting, sending and queueing |
| 11 · the sweep does not exist | **confirmed** (`sweepable` has no production caller) | the false claim withdrawn and the leak written down |

Its one piece of evidence that does **not** carry: `npx vitest run tests/uploads-api.test.ts` failed
three of eighteen for the reviewer because minting answered 500 in its sandbox. The same file is
18/18 green in this worktree, so those failures were the sandbox, not the code.

## Stages and actions

### Stage: the readiness gate on the server

Frontloaded, because everything else is unsafe without it and it stands on its own — it makes
`POST /api/jobs {uploadId}` refuse a file that is not there, which is right today as well.

- [x] Failing tests first, in `tests/uploads-api.test.ts` or a sibling:
  - [x] `POST /api/jobs {uploadId}` with **no staging object** answers 409 with the *not arrived*
        reason, claims nothing, enqueues nothing, and reserves no slot.
  - [x] the same call **with** the object, and an **expired** grant, succeeds — the object is the
        readiness state and the expiry has nothing left to protect.
  - [x] an upload that already has a job is answered with that job **without** taking a slot (the
        402 race: one slot left, an upload already queued).
  - [x] a cancelled/never-finished upload can never be turned into a job, however many times the
        address is reloaded.
- [x] `queueAnUpload`: `head` first; `resolveExistingUpload` split out and called before
      `withIngestSlot` in the route; the grant-expiry refusal narrowed to *no object*.
- [x] `publicUpload` gains `arrived: boolean` from the same `head`, so `GET /api/uploads/:id` is what
      a waiting page polls rather than re-POSTing a mutation on a loop.
- [x] New copy for the *not arrived yet* refusal — [copy.md](../project/copy.md), with its bracketed
      code.
- [x] Green: the new tests, `npm test`, `npm run typecheck`.

### Stage: the failing client tests

- [x] `tests/upload-engine.test.ts` — no React. `createUploadEngine` with a posed grant endpoint, a
      posed `put`, and a posed `send`:
  - [x] `start(file)` resolves with the upload id **before** the PUT resolves
  - [x] progress is reported to subscribers as the PUT reports it
  - [x] `POST /api/jobs {uploadId}` fires when the PUT resolves, **with no subscriber mounted**
  - [x] a failure in **queueing** retries the POST only, never the PUT
  - [x] a failure in **sending** re-PUTs, and a duplicate at our own staging key is treated as *the
        bytes landed* and goes on to queue
  - [x] `cancel()` aborts the PUT and posts nothing; the transfer is `cancelled`, not gone
  - [x] a second `start()` while one is in flight is refused, with a sentence
  - [x] the `article` outcome (retention has taken the job) is recorded as such, not as a job
  - [x] `stop()` on sign-out aborts the transfer and drops it; a POST that lands after it is fenced
        and does not reach the next reader
  - [x] the queue POST reports through `jobEngine.actionSucceeded/actionFailed` with a captured
        epoch, and **never** calls `jobEngine.start`
- [x] `tests/add-does-not-wait-for-the-upload.test.tsx` — jsdom, the headline behaviour: choose a
      file, press **Add**, assert the router has been sent to `/add/upload/<id>` while the posed PUT
      is still pending. Red before the work, green after.
- [x] `tests/upload-survives-leaving-the-shelf.test.tsx` — mount the add box, start a transfer,
      unmount it, resolve the PUT, assert `/api/jobs` was still posted. This is the one that pins
      the deleted abort-on-unmount, so it must be red first for the right reason.
- [x] Run them and read the failures. A test that was never red proves nothing
      ([silent-success.md](../reusable/silent-success.md)).

### Stage: the upload engine

- [x] `src/web/upload.ts`: split the exports — `requestGrant(file, signal)` and
      `putFile(grant, file, {onProgress, signal})` — with `put`'s thrown error carrying the real
      status. `uploadPdf` either goes or becomes the two of them in sequence. Transport behaviour
      unchanged; `tests/` for `realStatus` and `uploadFailure` must stay green untouched.
- [x] `src/web/uploadEngine.ts` — `createUploadEngine(deps)` and the singleton, modelled on
      `jobEngine.ts`.
  - [x] One transfer at a time. State: `hashing` → `granting` → `sending` (bytes) → `queueing` →
        `queued { jobId }` | `article { slug }` | `failed { phase, reason, retryable }` |
        `cancelled`.
  - [x] Holds the `File`, the grant, the `AbortController`, and the reader it belongs to.
  - [x] `start(readerId)`, `stop()`, `send(file)`, `cancel()`, `retry()`, `forget()`, `subscribe`,
        `getSnapshot`, `reset()`.
  - [x] Snapshot referentially stable between changes — `experimental-store.ts` § *the snapshot must
        be referentially stable* has the trap.
  - [x] `beforeunload` registered on entering `hashing` and removed on every terminal state.
- [x] `src/web/useUpload.ts` — the `useSyncExternalStore` wrapper, beside `useJobs.ts`.
- [x] `useJobSession` gains `uploadEngine.start(readerId)` / `stop()`.
- [x] Green: `tests/upload-engine.test.ts`, `npm run typecheck`.

### Stage: the shelf commits and leaves

- [x] `UploadPicker.tsx`: keep `chosen`, `problem`, the drag counter and `take`; delete `sent`,
      `sending`, `abort`, the `file` ref and the unmount abort. The progress row renders the engine's
      snapshot, so it is there whenever the reader comes back to the shelf.
  - [x] The filename in the progress row links to `/add/upload/<id>`.
  - [x] A drop still commits immediately, through the engine.
  - [x] The `x`: cancels a live transfer; calls `forget()` on a terminal one; forgets the chosen file
        when there is no transfer at all. One button, and every state it can be in has an answer.
- [x] `AddArticle.tsx`: `disabled={!slug && !chosen}`; a `lastTouched` of `"url" | "file"`; `submit`
      acts on it; the label reads *Add* or *Add PDF*; *Send it* deleted.
- [x] Green: the two jsdom tests. `npm test`, `npm run typecheck`.

### Stage: the add page watches the transfer

- [x] `AddPage.tsx`, upload arm only: if the engine has a transfer for this id, defer to it entirely —
      render the filename, the progress bar, the sending sentence, a Stop, and the phase-specific
      *Try again*; take `started` from the engine's outcome.
- [x] If it does not — a reload, a second tab — POST, and on the *not arrived* 409 **wait**: poll
      `GET /api/uploads/:id` and post when `arrived`. Stop when the grant has expired with no object,
      and say so: that transfer is not coming back, choose the file again. Render `cancelled` as
      itself rather than polling at it.
- [x] Quota and content refusals from the queue POST render here, through `QuotaNotice`, with the
      existing `worthRetrying` rule deciding whether *Try again* appears at all.
- [x] New copy, in the module that owns each: the sending sentence, the still-arriving sentence, the
      second-file refusal. [copy.md](../project/copy.md).
- [x] Green: `npm test`, `npm run typecheck`, `npm run check`. `npm run lint` on the touched files.

### Stage: see it work, and write it down

- [ ] Browser check in a **Sonnet subagent** ([browser-control.md](../project/browser-control.md)
      then [browser-testing.md](../project/browser-testing.md)), against the local server with
      `SPIDERYARN_STORE=postgres`. Throttle the connection so the transfer is slow enough to act
      during. Success criteria, in order:
  1. choose a PDF, press Add, and land on `/add/upload/<id>` with the bar still moving;
  2. navigate to the shelf and back — the bar is still moving in both places;
  3. navigate to `/profile`, wait for the transfer to finish, then return to `/add/upload/<id>` and
     find the ingest running or done;
  4. **reload `/add/upload/<id>` mid-transfer** — the page says the file is still arriving, the
     upload is *not* destroyed, and the original tab's transfer completes and queues it;
  5. **open `/add/upload/<id>` in a second tab mid-transfer** — same, and exactly one job results;
  6. press the `x` mid-transfer, then reload the address — nothing is ever queued;
  7. the console is clean throughout.
  - Tell it to kill its own dev-server PID, never `pkill -f vite`.
- [x] Rewrite [ingest-queue.md § Uploading a PDF](../project/ingest-queue.md#uploading-a-pdf): the
      *"the upload is not the ingest, and they happen in different places"* paragraph is now wrong in
      its second half, the three-line request diagram needs the navigation moved, and the readiness
      gate is a fifth *thing that is not obvious*.
- [x] Add the engine to [web-client.md](../project/web-client.md) beside `jobEngine`.
- [x] Note the uncalled `sweepable` leak where it belongs — a line in ingest-queue.md, not a new doc.
- [ ] Stop and review with Greg.

### Stage: the pre-existing 409, if Greg wants it now

Review finding 3, and **it is not caused by this work** — it is reachable today. If `enqueue` throws
after `claimUpload` succeeds and before `noteSlug`, the record is `claimed` with no job and no slug,
and every later POST answers 409 for ever. `asOf` expires only `pending`, so waiting does not help.
It matters more here only because the file being re-uploaded is, by construction, a slow one.

- [ ] Ask Greg whether this belongs in this piece of work or its own.
- [ ] If yes: a lease on the claim (an attempt id and a timestamp, as `JobStore` already does), so a
      claim abandoned for longer than the lease can be retaken. A catch-and-release does not cover
      process death between the claim and the catch.

### Stage: review and land

- [ ] GPT Sol review of the built code, with the scoped diff attached, weighted higher than this
      plan-stage review ([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)). Tell it
      the previous findings are at `260903j-…-review-sol.md`, that their fixes are unreviewed code
      written by someone else, and to spend the run on what has changed. Check the exit code *and*
      the answer file.
- [ ] Work each finding, then `npm test`, `npm run typecheck`, `npm run check`.
- [ ] Test consolidation pass in a subagent: four new test files is probably two too many.
- [ ] Commit per stage; push to `dev`.

## Watched red, and what the mutations found

Every gate here was made to fail before it was trusted, one mutation at a time.

| mutation | what went red |
| --- | --- |
| the `uploadHasArrived` call deleted from the route | 4 cases in `an-upload-is-queued-…`, each answering 202 and queueing a job over a file that was not there |
| the gate moved **ahead** of `resolveExistingUpload` | 2 cases: a never-minted id answered 409 instead of 404, and a repeat claim whose object had been swept could not find its own ingest |
| `resolveExistingUpload` deleted, so the repeat falls back inside `withIngestSlot` | `billing-admission`: *"the reload spent a slot of its own: expected `{taken: 2, inFlight: 1}` to deeply equal `{taken: 1, inFlight: 1}`"*. **`inFlight` 1, not 2** — the loser's reservation *is* released, so the leak is invisible to every count except the lifetime one, which is the count a free reader has three of |
| the abort-on-unmount put back in `UploadPicker` | `add-does-not-wait-…`: the PUT rejected with an `AbortError` and `/api/jobs` was never posted |

**Two bugs the tests found rather than the review.**

- **The fence was a session generation, and a cancel did not move it.** Pressing Stop while the
  grant request was still out left nothing to stop the grant: it arrived a second later, found the
  fence unchanged, and started a 40 MB PUT for a transfer the reader had already cancelled — nothing
  rendered it and nothing could stop it again. `fence` is now bumped by all four of `stop`, `send`,
  `cancel` and `retry`.
- **`npm run check`'s `committed` gate typechecks HEAD, not the working tree.** The first commit
  split `upload.ts`'s exports without its caller, so HEAD did not compile for one commit even though
  the tree did. Worth knowing: a stage boundary has to leave HEAD buildable, not just the tree.

**Three tests already in the suite were queueing uploads whose bytes had never arrived** — three
recovery cases in `uploads-api.test.ts` and one in `billing-admission.test.ts`. They land the object
now. That they existed at all is the clearest evidence the gate was missing: the old code let a job
be queued for a file that was never uploaded, and nothing minded.

**One piece of the review's evidence does not carry.** `npx vitest run tests/uploads-api.test.ts`
failed three of eighteen for the reviewer because minting answered 500 in its sandbox; the same file
is 18/18 here. `VERCEL=1` also switches minting off (`recordsSurviveTheRequest`), which is the trap,
and the new suite's `mint` helper now unsets it around its own call so no case has to remember.

## Appendix: the risks worth naming early

- **The `head` costs a Storage round trip on every `POST /api/jobs {uploadId}`.** Once per ingest,
  against a call that already does several. Named so nobody has to rediscover the trade.
- **Two writers of `/api/jobs`.** Engine and page. The readiness gate is what makes the second one
  safe rather than merely idempotent, and `queueAnUpload`'s claim-then-`taken` branch is what makes
  it single. The second-tab case is the one that exercises both, so it is in the browser checklist
  rather than only in a unit test.
- **`beforeunload` is not free.** Registered too eagerly it gives the reader a dialog when nothing is
  happening. It must follow the phase transitions exactly, and the browser check should include
  leaving the app with no transfer running.
- **Cancellation tells the server nothing.** The record stays `pending`, the staging object is
  absent, and nothing sweeps either — see *What this does not fix*. Unchanged behaviour, reachable
  more often.
- **`tests/public-network-trace.test.tsx` must stay green.** A signed-out visitor polls nothing at
  all, and the upload engine is a second thing that could break that if it ever reached for
  `jobEngine.start`. It does not — `epoch()` and the action seam instead — and that test is what
  would say so.
