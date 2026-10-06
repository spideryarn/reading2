# A provisional job snapshot outlived newer evidence

Up: [postmortems.md](../project/postmortems.md)

Stage 2 review reproduced an import card returning to its original running status after
the queue had shown it cancelled. Nothing established production exposure. `dba7839f9`
introduced the fallback to the POST's job snapshot.

The class is **provisional evidence with no expiry condition**. The fallback applied whenever
the list omitted the id, including after a newer list had shown a terminal state and another
tab dismissed the job. The original running snapshot then made Sharing and other controls
treat the import as active again. A job never observed in a list could also stay apparently
active after a fresh list proved it had disappeared.

Existing tests proved immediate rendering and that a matching list wins; they never tested
what follows that match. A new test asserted Retry remained after POST running → list
cancelled → empty list. Before the fix it failed: the card again showed Stop. Another test
delivered the engine's vanished outcome and found the original running card still present.

The lasting fix retains newer list state and uses the existing terminal watcher to hear endings
and fresh disappearance. A vanished import loses its card, stops being considered alive, and
asks the reader to check their shelf. It is never automatically posted again. The watcher is
cleaned up with its attachment and tagged by reader, source and job id. A terminal advance
also outranks an older active list entry for the same id: a third regression reproduced that
ordering during review of the fix.

The engine already distinguishes lists requested before registration from genuinely fresh lists.
The fix reuses that contract rather than treating any empty snapshot as proof of disappearance.
The corrected sharing-page suite is the regression check; the terminal-engine suite passed 12.

Countermeasures, ranked by cost against value:

1. Test a provisional snapshot after both newer terminal evidence and disappearance. Cheap;
   implemented, with both regressions seen red first.
2. Reuse the engine's existing terminal/fresh-list contract. Implemented; no second poller.
3. Discard the fallback on any empty list. Rejected: a request begun before the POST can
   legitimately omit the new job.

The lesson I would keep: a fallback is an answer to what we have not learned yet. Once newer
evidence arrives, it must not become a way to forget that evidence.
