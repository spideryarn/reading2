# A response-completion stamp cannot prove its snapshot is newer

Status: reproduced and fixed during review of `cac2fbf9f`, before landing this stage.
The mounted regressions pass with the fixes. No production incident is established. The stage is
[261005k, Stage 2](../plans/261005k-why-you-are-reading-feeds-the-command-bar-and-debate-takes-a-lens.md).

The command bar could restore suggestions derived from profile wording already superseded by a
newer read. The same review reproduced two lost response states and a selection changing when a
slow profile read inserted a row. Nothing was erased from the database.

## The class: completion order mistaken for observation order

The suggestion route reads the profile **before** waiting for the AI. Its returned fingerprint
describes that snapshot. However, `useReasonForReading.heard()` advanced the read generation when
the suggestion **arrived**, assuming its snapshot was newer than every GET.

A suggestion captures A; the bar closes; another tab saves B; reopening starts a GET for B. If
that GET finishes first, the old suggestion replaces B with A. If the suggestion finishes first,
it invalidates the outstanding GET, preventing B from correcting A. Both leave the old list
visible. This repeats the class in
[260905e](260905e-a-slow-response-overwrites-a-fast-one.md): a stamp taken at completion proves
arrival order, not freshness. The distinction between page ownership and response ordering also
appears in [260908c](260908c-an-opening-read-can-erase-a-later-write.md).

`cac2fbf9f` introduced this mechanism while adding retained suggestions. Two nearby assumptions
also lost information at the boundary: a failed purpose read became “none,” and a POST's
`no-reason` answer displayed a sentence without updating the cached “has” state. Separately, the
new asynchronously inserted offer row changed what an existing numeric selection addressed.

## Why the existing tests agreed

Same-tab save tests invalidated the request correctly. Cross-tab tests changed the profile only
after the suggestion had completed, or before the suggestion began. GET fixtures answered
immediately. None combined a slow suggestion, a cross-tab save and a reopening GET; nor did they
let a reader select an ordinary command before the initial GET completed.

Mounted tests added during review failed on the candidate:

- Both response orders expected no stale suggestion rows and received four.
- A stale `no-reason` reply displayed an absence message over a newer read with a reason.
- The failed-purpose test expected `REASON_NOT_READ.message` and received an empty status.
- The `no-reason` test expected the offer row absent and still found “Suggest what to do here.”
- After a delayed profile read, the selected command was “Plain,” expected “Structure.”
- After a save removed the selected suggestion, selection stayed on “Plain” instead of resetting
  to the offer row.

The reviewer inspected these assertion failures in `/tmp/command-suggest-review-red.log` and
`/tmp/command-suggest-selection-red.log`; those temporary logs are not durable artifacts. The
regression witnesses live in `tests/command-bar-suggest.test.tsx`.

## The durable fix and the countermeasures, ranked

1. **Controlled mounted tests of both response orders and delayed row insertion.** Cheap, already
   written and observed red. They test the reader's rows and selected command, rather than a
   helper's internal generation alone.
2. **Order observations at request initiation across GET and POST.** A suggestion may supersede
   earlier reads, but cannot invalidate a later-started GET. Preserve distinct failed/none/has
   states, apply the POST's absence observation, and preserve selection by row identity when
   asynchronous rows change. These narrow fixes are implemented; the six local suites run by the
   reviewing thread passed the new regressions and the associated local suites.
3. **Server profile revisions or cross-tab broadcasts.** Rejected for this fix: they add storage
   or coordination machinery, while this tab already receives the newer observation. Its loss
   comes from client ordering, not from an inability to learn about the save.

The lesson I would carry forward: I cannot call a response “newer” without naming when its data
was observed. I must also test the delayed read after the reader has acted; instant fixtures
silently grant response-state and selection assumptions that the real interface cannot grant.

Up: [Postmortems](../project/postmortems.md)
