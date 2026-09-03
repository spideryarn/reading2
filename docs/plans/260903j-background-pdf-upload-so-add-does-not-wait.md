# Background PDF upload, so Add does not wait for the bytes

**Status as of 2026-09-03: planned, not built** — evidence: `src/web/UploadPicker.tsx` still holds
the `File` in a ref, still aborts the transfer on unmount, and `send()` still calls `navigate` only
after `uploadPdf` resolves.

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
    │      └─ refusals (quota, not a PDF, too big) land here, on the shelf, as today
    │
    ├─ navigate("/add/upload/<id>")     ← immediately, with 0 bytes sent
    │
    └─ uploadEngine, in the background, wherever the reader goes next:
          PUT <signed url>  the whole file
          POST /api/jobs    {uploadId}
          → jobEngine picks the job up and drives it
```

The grant POST stays awaited because it is the thing that produces the address, it is small, and it
is where every refusal the reader can act on is decided. Everything after it is background.

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

### One button, and it is Add

Greg chose this over keeping *Send it* (2026-09-03):

```
  [ example.com/an-essay-worth-reading   ] [ PDF ] [ Add ]

    paper.pdf                        2.1 MB of 11 MB   [x]
    ▓▓▓▓▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░░
```

- Add is enabled when there is a valid URL **or** a chosen file.
- **A chosen file wins over a typed URL**, because it is the more recent intent; the `x` clears the
  file and restores the URL behaviour. The button's `title` names what it will add, so the rule is
  visible before it is applied rather than after.
- *Send it* is deleted. Dropping a file is still the commit gesture on its own (unchanged, and for
  the reason in `UploadPicker`'s header: a target that catches a file and then waits is
  indistinguishable from one that swallowed it).
- The file picker keeps its two gestures — choose, then Add — which is the safeguard the *Send it*
  button existed for.

### What this does not fix, and must say so

**Closing the tab still loses the upload.** The bytes exist only in the browser until they reach
Storage; there is no server-side copy to resume from and no way to make one without routing 50 MB
through a Vercel function that refuses bodies over 4.5 MB. So:

- a `beforeunload` guard while a transfer is in flight, so closing the tab is a choice rather than
  an accident;
- a sentence on `/add/upload/<id>` while sending, in the shape of `KEEP_A_TAB_OPEN`
  ([`src/job-state.ts`](../../src/job-state.ts)) but about the file rather than the ingest.

Switching tabs, navigating anywhere in the app, and locking the phone are all fine.

## The simpler options passed over

- **Leave the transfer in `UploadPicker` and merely navigate early.** Fails immediately: the
  component unmounts on the navigation, so either the abort-on-unmount kills the upload or removing
  it leaves an orphaned XHR whose completion nothing is listening for.
- **Hoist the transfer but let `/add/upload/<id>` own the `POST /api/jobs`.** Cheaper, and it breaks
  the actual request — leave that page and nothing queues the ingest.
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
  `uploadFailure`. The transport stays exactly as it is; only its caller changes.
- [`src/web/jobEngine.ts`](../../src/web/jobEngine.ts) — the pattern to copy: `createJobEngine`,
  `subscribe`/`getSnapshot`, `send<T>`, the module singleton, `reset()` for tests.
- [`src/web/AddArticle.tsx`](../../src/web/AddArticle.tsx) — the add row, `submit`, the Add button's
  `disabled={!slug}`, and where `uploadStatus` is placed.
- [`src/web/AddPage.tsx`](../../src/web/AddPage.tsx) — `/add/upload/<id>`: the post-once ref, the
  `article` outcome, `failure` vs `queue.error`, `JobCard`, `KEEP_A_TAB_OPEN`.
- [`src/routes.ts`](../../src/routes.ts) — `mintAnUpload`, `queueAnUpload`, `jobForUpload`. **No
  server change is planned**; `queueAnUpload` is already idempotent for a repeated claim, which is
  what makes a second tab harmless.
- [`docs/project/ingest-queue.md` § Uploading a PDF](../project/ingest-queue.md#uploading-a-pdf) —
  the evergreen doc this work contradicts in one paragraph ("Only when the bytes have landed does
  the reader go to `/add/upload/<uploadId>`"), which must be rewritten in the same piece of work.
- [`docs/plans/260826u-pdf-upload-and-storage.md`](260826u-pdf-upload-and-storage.md) — the original
  design, the measurements, and the two cross-family reviews.
- [`docs/plans/260903g-faster-shelf-load-and-tidier-homepage-controls.md`](260903g-faster-shelf-load-and-tidier-homepage-controls.md)
  § Stage 3 — why the add box has the shape it has, and why the drop target is the whole card.
- [`docs/project/copy.md`](../project/copy.md) — the rules for the two new sentences.
- [`docs/reusable/silent-success.md`](../reusable/silent-success.md) — the failure mode this whole
  area keeps producing; a background transfer is a fresh opportunity for it.

## Principles and key decisions

- **The engine owns the POST, and the page renders what it did.** One writer, so "add", "reload the
  page", and "open it in a second tab" cannot become two ingests. The page keeps its own POST for
  the one case the engine cannot cover — an address opened with no live transfer behind it — and
  that path is unchanged from today.
- **A refusal the reader can act on must be shown before the navigation.** Quota, not-a-PDF and
  too-big are all decided by `POST /api/uploads`, which is awaited on the shelf. Only transport
  failures land on `/add/upload/<id>`, where there is an address to retry from.
- **The transport is not touched.** `put`, `realStatus` and `uploadFailure` in `src/web/upload.ts`
  carry a lot of hard-won detail (`onload` fires for a 4xx; a duplicate arrives as HTTP 400 saying
  409). The engine calls them; it does not reimplement them.
- **The `File` stays in memory for the life of the transfer, and nowhere else.** No IndexedDB, no
  attempt at resumption across a reload — see *What this does not fix*.
- **`chosen` stays component state; the transfer does not.** A file picked and not yet committed
  should die when you leave the shelf. A file being sent should not.

## Stages and actions

### Stage: the failing tests

- [ ] `tests/upload-engine.test.ts` — no React. `createUploadEngine` with a posed grant endpoint, a
      posed `put`, and a posed `send`:
  - [ ] `start(file)` resolves with the upload id **before** the PUT resolves
  - [ ] progress is reported to subscribers as the PUT reports it
  - [ ] `POST /api/jobs {uploadId}` fires when the PUT resolves, **with no subscriber mounted**
  - [ ] a PUT failure leaves the transfer `failed` with the sentence from `uploadFailure`, and
        `retry()` re-PUTs the same `File`
  - [ ] `cancel()` aborts the PUT and posts nothing
  - [ ] a second `start()` while one is in flight is refused, with a sentence
  - [ ] the `article` outcome (retention has taken the job) is recorded as such, not as a job
- [ ] `tests/add-does-not-wait-for-the-upload.test.tsx` — jsdom, the headline behaviour: choose a
      file, press **Add**, assert the router has been sent to `/add/upload/<id>` while the posed PUT
      is still pending. Red before the work, green after.
- [ ] `tests/upload-survives-leaving-the-shelf.test.tsx` — mount the add box, start a transfer,
      unmount it, resolve the PUT, assert `/api/jobs` was still posted. This is the one that pins
      the deleted abort-on-unmount, so it must be red first for the right reason.
- [ ] Run them and read the failures. A test that was never red proves nothing
      ([silent-success.md](../reusable/silent-success.md)).

### Stage: the upload engine

- [ ] `src/web/uploadEngine.ts` — `createUploadEngine(deps)` and the singleton, modelled on
      `jobEngine.ts`.
  - [ ] One transfer at a time. State: `granting` → `sending` (bytes) → `queueing` →
        `queued { jobId }` | `article { slug }` | `failed { reason, retryable }` | `cancelled`.
  - [ ] Holds the `File`, the grant, and the `AbortController`.
  - [ ] `start(file)`, `cancel()`, `retry()`, `forget()`, `subscribe`, `getSnapshot`, `reset()`.
  - [ ] Snapshot must be referentially stable between changes —
        `experimental-store.ts` § *the snapshot must be referentially stable* has the trap.
  - [ ] After posting `/api/jobs`, poke `jobEngine.start()` so the new job is polled at once rather
        than on the next idle tick.
- [ ] `src/web/useUpload.ts` — the `useSyncExternalStore` wrapper, beside `useJobs.ts`.
- [ ] Green: `tests/upload-engine.test.ts`. `npm run typecheck`.

### Stage: the shelf commits and leaves

- [ ] `UploadPicker.tsx`: keep `chosen`, `problem`, the drag counter and `take`; delete `sent`,
      `sending`, `abort`, the `file` ref and the unmount abort. The progress row now renders the
      engine's snapshot, so it is there whenever the reader comes back to the shelf.
  - [ ] The filename in the progress row links to `/add/upload/<id>`.
  - [ ] A drop still commits immediately, through the engine.
  - [ ] The `x` cancels the engine's transfer when there is one, and forgets the chosen file when
        there is not — one button, the same two jobs it has today.
- [ ] `AddArticle.tsx`: `disabled={!slug && !chosen}`; `submit` sends the file when one is chosen and
      navigates to `addHref(url)` otherwise; the `title` names which; *Send it* deleted.
- [ ] `beforeunload` while a transfer is in flight, registered by the engine, removed when it is not.
- [ ] Green: the two jsdom tests. `npm test`, `npm run typecheck`.

### Stage: the add page watches the transfer

- [ ] `AddPage.tsx`, upload arm only: if the engine has a transfer for this id, defer to it — render
      the filename, the progress bar, the sending sentence and a Stop, and take `started` from the
      engine's outcome. If it does not, POST as it does today, unchanged.
- [ ] The transport failure sentence and *Try again* (which re-PUTs) render here, using the existing
      `worthRetrying` rule.
- [ ] New copy, in the module that owns each: the sending sentence, and the second-file refusal.
      [copy.md](../project/copy.md).
- [ ] Green: `npm test`, `npm run typecheck`, `npm run check`. `npm run lint` on the touched files.

### Stage: see it work, and write it down

- [ ] Browser check in a **Sonnet subagent** ([browser-control.md](../project/browser-control.md)
      then [browser-testing.md](../project/browser-testing.md)), against the local server with
      `SPIDERYARN_STORE=postgres`. Throttle the connection so the transfer is slow enough to act
      during. Success criteria, in order:
  1. choose a PDF, press Add, and land on `/add/upload/<id>` with the bar still moving;
  2. navigate to the shelf and back — the bar is still moving in both places;
  3. navigate to `/profile`, wait for the transfer to finish, then return to `/add/upload/<id>` and
     find the ingest running or done;
  4. press the `x` mid-transfer and confirm nothing is queued;
  5. the console is clean throughout.
  - Tell it to kill its own dev-server PID, never `pkill -f vite`.
- [ ] Rewrite [ingest-queue.md § Uploading a PDF](../project/ingest-queue.md#uploading-a-pdf): the
      *"the upload is not the ingest, and they happen in different places"* paragraph is now wrong in
      its second half, and the three-line request diagram needs the navigation moved.
- [ ] Add the engine to [web-client.md](../project/web-client.md) beside `jobEngine`.
- [ ] Stop and review with Greg.

### Stage: review and land

- [ ] GPT Sol review of the built code, with the scoped diff attached, weighted higher than the
      plan-stage review ([codex-cli-as-subagent.md](../reusable/codex-cli-as-subagent.md)). Check the
      exit code *and* the answer file.
- [ ] Work each finding, then `npm test`, `npm run typecheck`, `npm run check`.
- [ ] Test consolidation pass in a subagent: three new files is probably one too many.
- [ ] Commit per stage; push to `dev`.

## Appendix: the risks worth naming early

- **`beforeunload` is not free.** Registering it too eagerly gives the reader a confirmation dialog
  when nothing is happening. It must be added on the first `sending` and removed on every terminal
  state, and the browser check above should include leaving the app with no transfer running.
- **Two writers of `/api/jobs`.** Engine and page. The argument that this is safe is `queueAnUpload`'s
  claim-then-enqueue with a `taken` branch that returns the first claim's job — but it is an argument,
  and the second tab is the case that exercises it. Worth one deliberate manual check.
- **Cancellation semantics on the server.** Cancelling a transfer tells the server nothing; the
  record stays `pending` and is swept on its grant. That is today's behaviour for an aborted upload
  and is unchanged, but it becomes reachable more often, so it is stated rather than assumed.
- **The engine is a second thing that can wake `jobEngine`.** `start()` is currently the only way in,
  and that was made deliberate on 2026-09-01 for the signed-out guarantee. Poking it from the upload
  engine is fine — an upload requires an owner — but `tests/public-network-trace.test.tsx` is the
  test that would notice if it were not, so it must stay green.
