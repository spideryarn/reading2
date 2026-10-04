# A page mount cannot own writes to a reader setting

Review of candidate `0d4e273b374a21ac69f2745b60794e09a11fa0d7` found three ways the
new main-mode tick box could disagree with, or write to, the wrong reader's setting. These were
reachable client traces found before this review accepted the candidate; there is no evidence here
of an incident reaching a reader. The commit moved the decision from a browser to the publication
transaction, but left its client writes owned partly by a page mount and partly by a session.
The same review found that joining an existing server job preserved its old queue position rather
than the import's promised order. No Postgres run was available to this reviewer.

## The class: the visible control owns work that outlives its mount

The candidate's [`useAutoModesSetting`](../../src/web/auto-modes-setting.ts) serialised writes
inside one hook instance. The server setting, the old browser choice, and pending writes survive
that instance. Three consequences followed:

- A queued write called `save(next)` without a session signal. Reader A could press twice, sign
  out while the first save was pending, and leave the second save to acquire reader B's current
  token. An in-flight 401 could also refresh and retry as B through
  [`sendOwned`](../../src/web/lib/api.ts). The mounted guard suppressed only UI updates, not
  writes. The legacy hand-over already passed a session signal, so its protection did not extend
  to ordinary presses.
- The hook's first GET waited for `handingOver`, but its PATCH queue did not. An old `off`
  hand-over could remain pending while the reader pressed on; on could land first and off last.
  Two successive AddPage mounts had independent write queues and the same ordering problem.
- Failure restored `!next`, the inverse of the latest optimistic choice. With the confirmed
  server value on, two quick presses off then on followed by two refused saves left the box off,
  although the server remained on. Reversing a press is not recovering confirmed state.

All three defects were introduced in `0d4e273b3`; `git blame` assigns the hook's write queue,
unbound `save(next)`, and `setOn(!next)` to that commit. Its purpose was to make every import path
use the same server decision. The missing boundary was the lifetime of the reader's intent, rather
than the lifetime of the control showing it.

## The sibling class: joining work does not establish its prerequisites

An initial import commits an article row before publishing. The owner can therefore queue Quotes
by slug during import: `articleExists` accepts an unpublished row, and the running exclusive import
holds Quotes waiting. Publication then inserts labels and deduplicates its Quotes successor onto
that earlier holder. In the candidate, [`enqueueSuccessorIn`](../../src/store/pg-successor.ts)
returned `alreadyQueued` without moving it. After import, Quotes sorted before labels; labels is
exclusive, so labels waited for Quotes. The `notBefore` guarantee added in `0d4e273b3` applied only
to inserted rows, although an existing row represents the same successor work. The existing tests
covered an earlier labels holder, not an earlier mode holder.

## Why the supplied checks stayed green

The candidate's supplied evidence included 15 publication tests, 123 tests across four client/doc
files, and all four typecheck projects. The client tests covered an isolated failed press and the
hand-over independently. Their API mock ignored the request signal and did not switch credentials;
they did not hold a hand-over or previous mount's PATCH open while a later press completed.
The publication suite checked the server row, so it could not detect a client writing that row in
the wrong order or under a later account. Types allowed both the missing signal and inferred rollback.

The sibling worth reusing was already in
[`experimental-store.ts`](../../src/web/experimental-store.ts): session ownership, aborting
requests when the reader changes, and one write boundary across consumers. Its comments explain
the same 401 retry hazard. The newer hook applied that lesson to migration but not normal writes.

## What would have caught the class, ranked by ease against value

1. **Deferred-response client tests** — cheap, without Postgres. Hold writes open across account
   changes, migration, and unmount/remount; refuse two consecutive presses. Four new pure tests
   were observed red on the candidate and green with the coordinator. The signal test checks
   session abortion and discarded queued writes; it does not exercise real token refresh.
2. **One session-owned coordinator for this setting** — a small client change. Serialize every
   writer, retain the last confirmed server answer, and abort or skip queued work when its reader
   leaves. Keep work alive across navigation within the same reader's session. This closes the
   lifecycle boundary that per-mount response guards cannot.
3. **An earlier-mode-holder publication test** — added to the Postgres suite, but unrun here;
   neither a red nor a green database result is claimed. It checks deduplication, final row order,
   and that the held Quotes job cannot claim before labels.
4. **A cross-tab distributed write protocol** — rejected for this fix. It adds ownership and
   persistence machinery beyond these same-tab traces. These defects require sharing one queue
   inside the client session; no evidence here calls for a new server revision protocol.

## The fix that is right for the long term

The client fix makes the session own the write sequence and confirmed value, with the hook
subscribing to that state. Both the one-time hand-over and ordinary changes use that sequence.
Navigation leaves a reader's write intact; a reader change fences it.
Adding only an abort controller to each hook would fix the account retry trace while preserving
the competing migration and mount queues. Replacing `!next` alone would leave the ordering defects.

The server fix applies the successor's `notBefore` stamp to a deduplicated queued holder without
a draft, on the publication transaction. It preserves the holder's id and avoids retiming a live
attempt or a requeued draft. The prerequisite belongs to successor work regardless of which
request first inserted its row; it cannot be a property only of the insert branch.

Up: [Postmortems](../project/postmortems.md).
