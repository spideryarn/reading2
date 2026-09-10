# Stage 1 review findings

Review in progress. Findings are appended here as they are established.

## F11 — P1 — established: a second budget instance can settle and free a reservation it does not own

`Reservation` contains only the ledger-visible `{id, day}`, and `settle()` accepts any matching pair (`tools/overseer/model-budget.ts:158-159,561-585`). There is no instance/process ownership check. In `/tmp/repro-budget-owner.ts`, budget A reserves the last $0.01 of a $1.50 day; budget B on the same directory calls `settle(A.reservation, {calls:1, tokens:0, costUsd:0}, false)`, which returns `true`, removes A's in-flight worst case, and then grants B another reservation. A's request can still consume its reserved $0.01, so the ledger has authorized spend past the ceiling.

- Input/mutation: pass a live reservation returned by one `modelBudget({root})` instance to a second instance's `settle`; the reproduction prints `stolen: true` and `secondGranted: true`.
- Smallest fix: keep an instance-private set of reservation ids minted by that instance and refuse settlement unless the id is owned; remove it only after a successful persisted settlement. Add the two-instance last-$0.01 regression test. A crashed owner intentionally leaves its reservation charged at worst case.

## F12 — P1 — established: `unavailable` during a stale `no-question` re-read publishes a calm empty list

The pass preloads stale verdicts into `verdicts`, then excludes every fingerprint with any verdict from `unclassifiedFingerprints` (`tools/overseer/attention-pass.ts:227-235,276-293`). Thus an `unavailable` refusal while re-reading a stale cached `no-question` increments `budgetRefused` but leaves `sessionsUnreadable` at zero and `stopped` null. `/tmp/repro-unavailable-stale.ts` produces `{kind:"list", items:[], sessionsScanned:1, sessionsUnreadable:0}` with `budgetRefused:1`; the CLI and panel both render that as “nothing needs you / nothing is waiting on you.” This contradicts the accepted departure’s own claim that an unavailable budget leaves the tail counted unjudged, and the review’s explicit “any budget refusal” attack.

- Input/mutation: one ended turn with a stale cached `no-question`, then make its required re-read return `{notCalled:{kind:"unavailable"}}`.
- Smallest fix: track fingerprints whose attempted refresh was refused as `unavailable`, and count every matching session in `sessionsUnreadable` even when a stale verdict remains usable for placement. Keep the stale verdict/card, but make the list a floor (and an empty one `unknown`) rather than calm. Add both stale `no-question` and stale `question` unavailable tests.
