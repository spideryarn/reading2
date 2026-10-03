# Payload presence is not a state transition

Stage 2 of [the timestamp audit](../plans/261003j-store-when-it-happened-timestamp-audit.md)
added `articles.updated_at` to record real reader changes. Review F10 found that repeating the
current title, purpose or archive state stamped a new time. The candidate is commit `bebff74dc`;
this review did not establish whether it had reached readers.

The root cause, independently checked by the review's write-path audit subagent, was treating a
non-empty update payload as evidence that stored state changed. Normalization makes the gap wider:
`" Same title "` and `"Same title"` are the same setting. The existing archive write already kept
the original `archived_at` on a repeated archive, while the new clock claimed another change.

The class is **payload presence substituted for changed state**. The candidate's tests exercised
different settings in sequence and an empty change, but not non-empty requests whose values were
already in effect. All could pass while the event column recorded invented transitions.

The fix compares each supplied, normalized setting with the current row inside the same `UPDATE`,
using null-safe `IS DISTINCT FROM`. Archive state is compared as a boolean. A `CASE` advances
`updated_at` only when any setting differs; otherwise it preserves the old time, including null.
Keeping the comparison in SQL avoids a read/check/write race and preserves the existing missing-row
response. This is the long-term fix as well as the review patch.

Countermeasures, ranked by cost against value:

1. Repeat the named action in a store regression, with normalized inputs and both legacy-null and
   timed rows. Added to [event-times.test.ts](../../tests/event-times.test.ts), along with a patch
   containing both repeated and changed settings. Postgres was unavailable to the reviewer, so
   these tests were written before the fix but were not observed red or green; the implementer
   must run them and demonstrate that the candidate fails them.
2. For each event clock, test the distinction between a request and a transition. This is cheap
   when the product requires idempotency, but is not universal: the Stop clock deliberately records
   the latest accepted request even when a live job is already stopping.
3. A generic database trigger on every row update was rejected: it would also count opens,
   publication and visibility changes, which this clock intentionally excludes.

The related clock review F11 found a reasoned ordering risk: a JavaScript date bound before a
row-lock wait, or transaction-start `now()`, can predate an intervening committed reader change.
The new settings clock now uses database `clock_timestamp()` at the update. The older
`high_power_since` meaning and billing's post-lock charge clock remain as they were. The new
High-powered AI regression supplies a slow application clock; its Postgres result is likewise
unverified here, and it does not reproduce the lock race itself.

Up: [Postmortems](../project/postmortems.md)
