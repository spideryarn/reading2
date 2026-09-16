# Code review findings: reading time

Reviewed 2026-09-16 against `7c39e670..f803b076`. No P0 finding.

## Findings

### 1. P1 — the opening read and additive writes race, so the displayed total can be too high or too low

**Claim.** The client begins the opening GET and the flush timers independently. A slow opening GET
can read a batch this same mount has already POSTed; the response is then installed as `server` and
the same seconds still remain in `local`, so the display counts them twice. The opposite race occurs
on a quick trip from the reading view to Metadata and back: the new mount's GET can overtake the old
mount's cleanup POST and omit those seconds until a later reload.

**Evidence.** Every credited second is retained in `local`
([`src/web/useReadingTime.ts:186`](../../src/web/useReadingTime.ts#L186)); ordinary and cleanup
flushes can POST it while the opening GET is still unresolved
([`src/web/useReadingTime.ts:194`](../../src/web/useReadingTime.ts#L194),
[`src/web/useReadingTime.ts:242`](../../src/web/useReadingTime.ts#L242),
[`src/web/useReadingTime.ts:254`](../../src/web/useReadingTime.ts#L254)); and the late response is
unconditionally installed in `server` before the display recomputes `server + local`
([`src/web/useReadingTime.ts:246`](../../src/web/useReadingTime.ts#L246),
[`src/web/useReadingTime.ts:150`](../../src/web/useReadingTime.ts#L150)). `gone` prevents an old GET
from changing an unmounted component, but it does not order the old cleanup POST before the next
mount's GET.

**Fix.** Serialize ordinary writes for one reading-time path, make a new opening GET wait for prior
writes, and defer this mount's ordinary flushes until its opening GET settles. Cleanup and
non-bfcache `pagehide` must still take and send the batch immediately because there may be no live
mount left to release it; a bfcache page remains live and must preserve the ordering. Add one test
with a held opening GET across hide and bfcache `pagehide`, and one with a held cleanup POST followed
by a remount.

### 2. P1 — the body-size gate rejects a batch the inner contract accepts

**Claim.** A valid batch of 5,000 entries can receive 413 before `readingTimeBatch` can accept it.
The route therefore violates its declared wire contract at the exact boundary the limit and its
test say they protect.

**Evidence.** `MAX_READING_TIME_BODY_BYTES` budgets 23 characters for each JSON number
([`src/routes.ts:495`](../../src/routes.ts#L495)), while a positive finite value below 3,600 can be
24 characters as emitted by `JSON.stringify`, for example `0.0000010000000000000002`. The validator
accepts every positive finite value at most 3,600 ([`src/routes.ts:1038`](../../src/routes.ts#L1038)).
The boundary test uses `3599.9999999999995`, only 18 characters, so it does not exercise the claimed
worst case ([`tests/reading-time-route.test.ts:199`](../../tests/reading-time-route.test.ts#L199)).

**Fix.** Budget 24 characters per positive JSON number and change the 5,000-entry boundary test to
use a 24-character accepted value; the unchanged code must fail that test with 413.

### 3. P2 — the POST validator silently accepts surplus top-level fields

**Claim.** The documented request is `{ seconds: ... }`, but a body such as
`{ seconds: {}, replace: true }` is accepted and returns 204. Silently ignoring a future or stale
client's operation field is a maintenance risk for an additive endpoint.

**Evidence.** `readingTimeBatch` destructures `seconds` without checking the object's other keys
([`src/routes.ts:1026`](../../src/routes.ts#L1026)). This file's established boundary rule is to
reject unknown request fields rather than let disagreeing client and server shapes appear to work
(for example [`src/routes.ts:5751`](../../src/routes.ts#L5751)).

**Fix.** Reject every top-level key other than `seconds` with fixed, non-user-controlled error prose,
and add it to the route's malformed-batch table.

## Checked and found sound

- With the experimental switch off, the hook installs no listeners or timers, performs no GET or
  POST, returns the shared empty level map, and both display components render nothing.
- A visitor has no reading-time capability, never mounts `useReadingTime`, and the server resolves
  both verbs through `articleIdForOwned`, so a shared-link visitor can neither see nor add totals.
- Pending batches are taken synchronously before a send; hidden, `pagehide`, cleanup and StrictMode
  cleanup therefore cannot send the same pending map twice.
- The gutter has no competing `.blk-gutter::after`; it remains present on touch and narrow layouts.
- The composite foreign key, additive SQL update, paint order, and both export projections match the
  plan's contracts.
