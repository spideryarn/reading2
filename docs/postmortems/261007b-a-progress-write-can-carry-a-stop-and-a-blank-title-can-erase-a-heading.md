# A progress write can carry a Stop, and a blank title can erase a heading

Caught in the write-capable review of
[the queue stage](../plans/261007b-seventh-sweep-job-queue-tier-0.md), 2026-10-07.
Root causes independently checked by the review subagent. No production incident was measured.
The review had no database; every case it wrote was run against Postgres afterwards, and the
third section's defect, which it left open, was fixed then.

## An optional write carrying a control message

**Class: treating a control-bearing operation as optional display work.** Commit `7d3a4b4d9`
made a failed progress write tolerant to avoid abandoning a live claim. A between-step failure
could now miss Stop and continue. The next starting or skipped-step write could successfully
return `cancelling`, but the coordinator ignored that response. If the next step was last,
completion cleared Stop and published. The ignored starting response predates this stage
(`ceec42fc8`); swallowing the preceding failure made this interleaving newly reachable.

The scoped fix consumes cancellation at both boundaries, before starting more work or completing
an all-skipped tail. It uses existing cancellation settlement and copy. Stop during an already
running last step retains its two characterised outcomes. Repeated progress failures can still
hide a remote Stop; the finite walk and claim deadline bound the exposure. The operation's
return value is a control message even when its write is display work.

## Absence mistaken for replacement data

**Class: treating blank optional input as a replacement value.** Commit `3908e84f3` added a title
to progress writes and extended the title assignment to Metadata. The assignment accepted blank
detail; the store distinguished only `undefined`, accepting empty and whitespace titles. The
unconditional Extract assignment predates this stage (`12081b0d7`, carried into products by
`0f5288605`). Nonblank guards at both boundaries preserve the claimed and stored title. A missing
optional store argument already preserved the title; that behaviour is now tested alongside blanks.

## A durable receipt mistaken for display work

`stillForced` also consumes the persisted job step's status. Artefacts being current cannot prove
that a force request has been honoured. If a kept commit completes a forced step but the subsequent
progress writes fail, pause can reset the old stored running status to pending. A resumed claim
then repeats the completed forced step. This wider defect predates this stage through expiry after
a failed progress write; tolerant continuation exposes it through a clean mid-step pause as well.
The receipt split originated in `ceec42fc8`, which added `keep` without a job-row write.

**Class: a fact that decides spending, written after the transaction that made it true.** The
review left this one open, with a Postgres regression it could not run and a verdict of not ready
to ship. Run afterwards, the regression was red: `extract` ran twice. The older road was
reproduced too, with the progress write put back to rethrowing as it did before the stage: the
lease lapses between the commit and the write, the sweep requeues, and the forced step runs again.

**The fix** puts the job's steps in the commit that keeps the product. `keep` now carries them,
and the Postgres session writes them in the same transaction (`keepStepIn`,
`src/store/pg-jobs.ts`), on a row that transaction had already locked. About twenty lines, no
column, no migration. Both roads are closed by it, and so is the one neither test needed a failure
for: a claimant killed between the commit and the write. Taking the write out of the session, or
handing it steps that do not say `done`, turns both Postgres cases red.

With that in, a progress write carries the card and one look at Stop and nothing a repeat
purchase rests on, so tolerant continuation stays. Ending the job on a failed progress write was
weighed and not taken: Retry gives a forced job its force back, so that ending would itself send
the reader to buy the finished steps again.

## What would have caught these classes, ranked by ease against value

1. **Ask of every write outside a transaction what reads it back to decide something.** That is
   the question that finds the receipt, and it was answerable from `stillForced`'s own comment,
   which says the job record is the only account of a spent force there is. In
   `src/store/session.ts`, `JobTransition` said the same field was a progress bar nothing decides
   anything on.
2. **Combine failure with a later successful control response.** Offline and Postgres regressions
   reproduce the starting and skipped-tail Stop interleavings; each goes red with its fix removed.
   Testing only a write failure with no Stop cannot catch this class.
3. **Test optional replacements at their boundaries, and assert outside the code under test.**
   Offline coordinator cases reproduce blank title loss. The Postgres cases for undefined, empty
   and whitespace titles passed as first written whether or not the store had its guard: their
   assertions were inside a step's body, where a failed `expect` is a step failure the walk
   records. They read inside and assert outside now, and the two blank cases go red without the
   guard. A test written with no database to run it on was the one that could not fail.
4. **Observe novel artefacts, rather than fixture freshness.** The original deadline test reused
   seeded output and faked freshness, so it could pass after an erroneous late commit. Its revised
   case returns a distinct metadata title, counts commits and reads the real paused draft; a build
   that commits the late product and then pauses fails it on the commit count.
5. **Reject a new title type or queue retry mechanism for this stage.** Neither removes the need
   to consume control responses or validate replacements. They add machinery where two boundary
   checks and adversarial inputs suffice. A separate cancellation protocol is wider work.
