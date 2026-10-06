# Replacing a read must not erase unresolved reconciliation facts

Up: [postmortems.md](../project/postmortems.md). Found while reviewing
`c6e162610`; deployment impact was not checked. A reducer test reproduced an
old answer returning under an edited question after a newer repair replaced
the edit's repair.

The edit's failed request restores its old rows and starts a repair with
`drop`: those rows must not be retained if the server deleted them. While that
read is pending, the reader can retry the restored answer. Its failure starts
a newer repair with an empty discard set, superseding the edit's repair. The
new server snapshot then acquires the old answer as a local extra row.

Supersession predates this commit; the edit discard bookkeeping introduced in
`c6e162610` makes forgetting that metadata harmful. The class is **request
lifetime mistaken for reconciliation lifetime**. Replacing a request does not
resolve what its predecessor was trying to establish. A failed repair read
also retires without establishing whether the edit landed, so inheriting only
from live operations would still lose the discard in that ending.

The fix records unresolved exclusions per conversation in
`ChatState.repairDrops`. Both typed and spoken repair registrations accumulate
them. Failed or stale reads leave them alone; a fresh copy actually applied to
the conversation clears them. A successful spoken append, or a spoken pair
confirmed by repair, applies those exclusions too. Server rows always survive:
an exclusion only controls rows absent from the authoritative copy. Thread
renaming moves the map key, and the purity harness seals and compares it.

Six tests were seen red: replacement by retry/spoken repair after a pending or
failed edit repair returned `[q1, a-srv, a1]`; confirmed spoken append/repair
also appended `a1` after the spoken pair. Each expected the authoritative rows
without that old answer. The tests also check stale repair rejection and that
successful reconciliation clears the exclusions.

Countermeasures, ranked by cost against value:

1. Include replacement and read failure in reconciliation tests, not only
   one request followed by its successful read. These six cases now run.
2. Store unresolved facts independently from the request that first recorded
   them. Implemented with one map and one repair-registration helper, rather
   than different inheritance rules at the two registration sites.
3. Inheriting only from live repairs was rejected: a failed read erases the
   only source of that inheritance. Dropping the rows when a read fails was
   also rejected: it would remove a previous answer without establishing that
   the edit actually landed, reproducing the bug this change is meant to fix.
