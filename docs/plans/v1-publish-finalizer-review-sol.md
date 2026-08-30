# NO-SHIP

The session wrapper is the right seam, and publication plus `finishIn` are correctly atomic. Two failure-boundary bugs need fixing before shipment.

## Findings

### Critical — publication failures can log article content in raw SQL parameters

[`finishIn`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-jobs.ts:517) binds the complete `ending.steps` and title. Drizzle includes bound parameters in database-error messages.

The finalizer catches that error and interpolates the unsanitized message into `reason` at [`publish-session.ts:233`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/publish-session.ts:233). `failRevision` then logs that string unchanged at [`pg-revisions.ts:1452`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:1452).

That can expose article titles and arbitrary step detail; [`jobs.ts:554`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:554) explicitly acknowledges that detail may contain article content. The outer `guardDbStore` runs too late: the logging has already happened before the error is rethrown.

The atomicity test’s NUL injection at [`jobs-publish-finalizer.test.ts:548`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/jobs-publish-finalizer.test.ts:548) deterministically exercises this path. It is valid evidence for rollback atomicity, but it cannot detect the leak because test logging is silent and the payload contains no sensitive sentinel.

There is a second version at [`publish-session.ts:238`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/publish-session.ts:238): if the compensating cleanup itself fails, `errorFields(cleanup)` also logs the raw database error.

Use a fixed, safe cleanup reason and scrub cleanup failures before logging. Do not incorporate arbitrary `err.message`.

### High — an all-skipped publication failure leaves the job `running`

The deterministic control flow is:

1. An all-skipped walk reaches [`jobs.ts:1396`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1396).
2. `endJob` calls `session.settleJob` at [`jobs.ts:709`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:709).
3. The publishing wrapper calls `publishAndFinish` at [`publish-session.ts:306`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/publish-session.ts:306).
4. Any non-stale publication error escapes.
5. `walkClaim` handles only `StaleAttemptError`; everything else is rethrown at [`jobs.ts:1398`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1398).

Unlike the commit door, this path is not inside `runStep`’s failure settlement. The job therefore retains its attempt, `running` status, and global running slot. Retries report busy until the 760-second lease expires; a later advance records a generic interruption instead of the real publication failure. Without another advance, it can remain running indefinitely.

The tests expose the hole:

- The empty-copy test calls `session.settleJob` directly at [`jobs-publish-finalizer.test.ts:472`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/jobs-publish-finalizer.test.ts:472), then manually deletes the still-running job at [line 487](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/jobs-publish-finalizer.test.ts:487).
- The atomicity test explicitly asserts the job remains `running` at [line 558](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/jobs-publish-finalizer.test.ts:558), then manually deletes it.

Those tests correctly establish refusal and rollback, but they do not establish the claimed reader-job-card outcome. Add a coordinator-level test that drives the all-skipped door through `advanceJobWith`, injects a finalization failure, and requires an immediate terminal `error` containing the safe publication failure.

## Design answers

1. I found only the two `done` doors you identified: last-step `commit`, and all-skipped `settleJob`. The wrapper is therefore the correct architectural location.

2. Writing filesystem artefacts before the publication transaction is reasonable. The observable interruption states are:

   - Before opening the draft: files may be complete while the job remains running and nothing is published.
   - After draft creation but before publication: files and draft remain; the article pointer stays unchanged.
   - During copy/publication/finish: the database transaction rolls all three back; filesystem files remain.
   - After commit but before response/logging: both article and job are correctly committed; only acknowledgement is lost.

   The remaining non-transactional risk is a changing source directory producing a mixture across steps. Per-step partial products are refused, but the filesystem is not a whole-job snapshot.

3. Lazy draft creation and compensating `failRevision` are sound. Skipping compensation after claim loss is also correct because the old claimant cannot pass the job fence. The comment that there is “nothing to clean up” is imprecise—the abandoned draft can remain—but `failExpired` clears ownership and the sweeper can reclaim it.

4. The lock order is consistent: article before job in draft creation, publication, and failure. `failExpired` and cancellation touch the job without subsequently acquiring the article, so they do not create the reverse edge needed for a deadlock.

5. `PublishRefused` with status 409 is the correct class for an empty-copy precondition failure. However, surviving `guardDbStore` is not enough to put it on the job card: the all-skipped failure currently escapes without settling the job.

Repeat publication does not delete reader data. This path does not call the destructive importer; it moves the article revision pointer, carries previous artefacts into the draft, and preserves article-scoped reader records and stable block identities. A removed block may stop an annotation from resolving visibly in the new revision, but the underlying reader record is not deleted.