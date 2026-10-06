# A read completion does not prove it followed a write

Up: [postmortems.md](../project/postmortems.md)

Stage 2 review caught the new private-link controller overwriting a successful create or
turn-off with an older attachment read. Production exposure was not established. `dba7839f9`
introduced the controller and its reconciliation rule.

The class is **completion order mistaken for observation order**. `asked` checked only whether
`inFlight` was still set when the read arrived. A read can observe the row before a write,
wait on its reply, and arrive after the write has completed and cleared `inFlight`.

Two tests in `tests/add-share-link.test.ts` crossed that interval. The first returned OFF after
a successful create and incorrectly lost the key. The second returned ON after a successful
turn-off and incorrectly drew the revoked key. Both failed before the fix. Existing attachment
tests covered reconciliation without overlapping a write.

The lasting fix remembers the write generation and whether a write was already outstanding
when the attachment began. Only an uninterrupted read can reconcile. Writes also invalidate
older manual checks. The controller suite passed all 48 tests after the fix.

Countermeasures, ranked by cost against value:

1. Cross the read with both mutation directions in deferred-response tests. Cheap; implemented.
2. Fence asynchronous reconciliation against intervening writes. Small; implemented.
3. Serialize every read and write. Rejected: it adds coordination without preserving any
   necessary behaviour beyond the fence.

The lesson I would keep: an empty in-flight slot describes the present. It cannot establish
when an answer observed the server.
