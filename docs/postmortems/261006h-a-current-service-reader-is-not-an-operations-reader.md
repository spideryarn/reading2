# A current service reader is not an operation's reader

Review of `4fc001a6d` on 2026-10-06 found three requests made for A leaving with B's
token. They were reproduced using the real client request layer and mocked auth and
transport boundaries; production impact was not assessed. The review fixes are
uncommitted in the candidate worktree.

## The class: operation ownership inferred from mutable service state

A transport fence can compare the token perfectly and still approve the wrong
request. Its expected reader must belong to the operation, rather than whichever
reader the service happens to be bound to when a later continuation runs.

The candidate passed `jobEngine.reader()` or `batchUpload.reader()` into `apiFetch`.
That missed three lifecycle boundaries:

- **F7: initial mounting.** The add page's child passive effect posted before
  `useJobSession`'s parent passive effect bound the engine. The request captured
  `null`, meaning unfenced. Holding the token lookup until B signed in produced
  `POST /api/jobs as TOKEN-B` even though the page had stopped.
- **F8: late cleanup.** A grant returned after A's batch was torn down. The
  intentionally stale cleanup branch read the new batch binding, B or `null`,
  rather than A. Both reproductions produced
  `DELETE /api/uploads/upload-A as TOKEN-B`.
- **F9: an extra promise boundary.** `sendIt` checked its lifetime before returning
  an upload id. B bound the batch in the microtask before `run` resumed. `run`
  did not check again and produced `POST /api/jobs as TOKEN-B` for A's upload.

The passive session hook originated in `a2e55ead2d`. The two batch continuations
originate in `67e71b8a29` (the batch-upload stage). Candidate `4fc001a6d` added
the ownership fences without closing those boundaries. Its promise that every
covered request named its original reader was therefore false.

## Why the existing tests agreed

The page-change harness replaced both `useJobs` and `useJobSession`, removing
the child/parent effect ordering. The engine tests explicitly started A before
sending. They proved the transport check when handed the right reader, while
assuming the lifecycle always supplied that reader. They also switched accounts
before requesting a grant, rather than during a late answer or between two
promise continuations.

## The fix and its limits

`useJobSession` binds in a layout effect, before child passive effects can start
work. The token-resume effect remains separate, so refreshing A's token still
preserves A's transfers. Batch cleanup receives the reader captured before the
operation's waits, and `run` rechecks its lifetime after awaiting `sendIt`.

These are the smallest fixes for the observed paths. A broader design would
carry an immutable reader with every operation through every dependency call.
That is unnecessary churn for this stage: the other examined job/upload loops
already check their lifetime before subsequent work. Plain `apiFetch` callers
outside the stage remain outside its guarantee.

## Countermeasures, ranked by ease against value

1. **Exercise lifecycle boundaries through the real adapters.** Done in
   `tests/add-page-reader-change.test.tsx` and
   `tests/engines-send-as-their-reader.test.ts`: mount with the real session hook,
   settle a late grant after teardown, and switch readers between promise
   continuations. All three failure shapes were seen red before their fixes;
   matching-reader controls preserve ordinary imports and cleanup.
2. **Check ownership and lifetime separately after each wait.** The batch fix
   does both: cleanup keeps its original reader even when stale, while new work
   requires a live operation. A lifetime check in the callee does not authorize
   work in its caller's later continuation.
3. **Make every API request require an operation context.** Rejected for this
   stage. It changes the app-wide request interface and the deliberate scope of
   the candidate. It would not remove the need to test who creates that context.

Up: [Postmortems](../project/postmortems.md)
