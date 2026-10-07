# A progress write can carry a Stop, and a blank title can erase a heading

Caught in the write-capable review of
[the queue stage](../plans/261007b-seventh-sweep-job-queue-tier-0.md), 2026-10-07.
Root causes independently checked by the review subagent. No production incident was measured.

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
The offline coordinator characterisation executes Extract twice. The real Postgres regression is
unrun, and the fix remains outside the review's permitted session files. An atomic completion
receipt is the long-term fix; the review is **not ready to ship** with that harmful default intact.

## What would have caught these classes, ranked by ease against value

1. **Combine failure with a later successful control response.** Added offline regressions reproduce
   the starting and skipped-tail Stop interleavings. The corresponding Postgres cases are unrun
   in this sandbox. Testing only a write failure with no Stop cannot catch this class.
2. **Test optional replacements at their boundaries.** Offline coordinator cases reproduce blank
   title loss; Postgres cases cover undefined, empty and whitespace progress titles, unrun here.
3. **Observe novel artefacts, rather than fixture freshness.** The original deadline test reused
   seeded output and faked freshness, so it could pass after an erroneous late commit. Its revised
   case returns a distinct metadata title, counts commits and reads the real paused draft. Unrun
   here; offline cases separately assert that no late product reaches commit.
4. **Reject a new title type or queue retry mechanism for this stage.** Neither removes the need
   to consume control responses or validate replacements. They add machinery where two boundary
   checks and adversarial inputs suffice. A separate cancellation protocol is wider work.
