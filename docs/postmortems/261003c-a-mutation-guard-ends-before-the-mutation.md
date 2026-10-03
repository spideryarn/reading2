# A mutation guard ends before the mutation

Up: [postmortems.md](../project/postmortems.md) · candidate:
[261003j](../plans/261003j-mark-a-feedback-report-as-ignored-from-the-admin-page.md)

Caught in the code review of `14e70b90b`, 2026-10-03. Reproduced locally with
deferred fetch responses; production impact was not measured.

## The class: a mutation's exclusion guard expires before the mutation

`useAdminFeedback.setIgnored` shared a hook-local guard with the list reads.
But switching Everyone / Readers only remounted that hook, cleared its guard,
and started a fresh GET while the PATCH continued. A GET taken before the
write committed could return the old mark; the old hook deliberately discarded
the PATCH response, leaving the new card stale.

Commit `14e70b90b` introduced the write into an existing read lifecycle. A keyed
remount was sound for cancellable reads; a write continues after that lifecycle
ends. The guard's ownership did not grow with the operation's lifetime.

## Why nothing went red

Existing tests covered Refresh during PATCH and filter switching during GET
separately. Neither exercised filter switching during PATCH. The new success
and failure regressions both failed with `expected ... length of 2 but got 3`:
the third request was the successor inbox's GET.

## The fix and countermeasures

1. **Test the intersection of writes and remounts.** Added deferred-PATCH tests
   in `tests/admin-feedback-from.test.tsx`, including failure recovery and two
   clicks before React redraws the buttons. Each failing schedule was seen red.
2. **Give the guard an owner that survives the attempted remount.**
   `AdminFeedbackPage.runWrite` acquires a synchronous guard and releases it in
   `finally`; the filter buttons wait for the write. Switching during GET
   remains available. A rejected duplicate invocation cannot release another
   invocation's guard. This is the fix for the page's filter boundary.
3. **A global mutation coordinator was rejected.** It would add machinery for
   arbitrary navigation; this change needs coordination within one page.
   Aborting the PATCH was also rejected: aborting transport cannot undo a
   server write. Navigation away from the entire page remains outside this
   page-local serialization guarantee.

The lesson: when a read hook gains a write, review every boundary that formerly
made abandoning its requests safe.
