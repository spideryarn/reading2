# Operation ownership is not persistence provenance in a snapshot merge

Up: [postmortems.md](../project/postmortems.md). Found while reviewing
`c6e162610`; deployment impact was not checked. The scoped tests reproduced
deleted rows remaining on screen after an edit's response was lost.

`discardedBy` protected every other live turn's question and answer from the
edit's repair. That protection is needed for an unconfirmed send: its pair is
optimistic and may not exist in the server's snapshot yet. A retry, however,
names an existing stored answer, and a send that has received `begin` has
confirmed its pair. When an edit deletes those stored rows, protecting them
from `drop` appends them beneath the replacement answer.

The reducer admits overlapping operations. A delayed retry preserves the
tail's stored id, so an overlapping edit can pass the server's tail check
before the retry request arrives. The edit writes before its `begin` frame;
losing that response starts the repair. The retry's later refusal cannot undo
the resurrection, because its own repair drops no rows. The ordinary UI
disables submission while busy, including an already open editor; the tests
exercise the overlap the controller and reducer still admit.

The class is **operation ownership mistaken for persistence provenance**.
Being held by a live operation does not mean a row is provisional. The new
helper in `c6e162610` introduced that assumption. The existing overlap tests
covered unconfirmed sends, so they agreed with the overly broad protection.

The narrow fix protects only another send that has not begun. Recovery watches
stored rows and needs no exemption; spoken rows are projected outside `base`.
Both new reducer tests were seen red: the retry case returned
`[q1, a-srv, a1]`, and the confirmed-send case returned
`[q1, a-srv, q2, a2]`, rather than `[q1, a-srv]`.

Countermeasures, ranked by cost against value:

1. Test both provisional and confirmed rows in each reconciliation exemption.
   Added the retry and confirmed-send cases; retained the existing provisional
   send coverage. The retry case also follows its later refusal and repair.
2. Keep persistence confirmation explicit in the exclusion predicate. The
   existing `shape` and `began` fields suffice here; a live operation alone
   does not establish it.
3. A separate provenance field on every message was rejected: it would add a
   second fact to maintain when these operation fields already provide the
   distinction needed by this helper.

This closes the exemption bug, not all reconciliation races. The plan's held
Stop, unbounded ordinary repair read, and optimistic title cases remain outside
this review fix; see
[261006d](../plans/261006d-chat-keeps-the-previous-answer-when-a-retry-or-edit-fails-before-the-stream.md#the-plan-review-gpt-sol-2026-10-06).
