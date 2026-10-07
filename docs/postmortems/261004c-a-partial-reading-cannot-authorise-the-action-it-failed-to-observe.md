# A partial reading cannot authorise the action it failed to observe

The code review of [plan 261004c](../plans/261004c-sweep-cluster-11-no-blocking-child-process-on-the-dashboard-or-the-daemon.md)
found two decisions that promoted incomplete evidence into permission: starting an agent from a
partly unreadable health survey, and carrying a question's wait across two unproven tmux
generations. The dashboard and daemon had not been restarted with the candidate. These candidate
paths reached no operator through a deployed restart; the inherited defects below predate it.

## The class: an unknown input becomes positive evidence at its consumer

**F10, health admission.** `computeVerdict` deliberately reports the severity supported by the
readable fields; it is not a certificate that all core fields were read. Its `coreReadable` is an
OR of load, memory and swap. `newSessionHealthLevel` reused that display verdict as permission to
launch. With `uptime`, `nproc` and `free` refused, but low-use swap readable, the collector retained
unknown load and memory, yet admission returned `ok`. The reviewer's regression failed with
**expected `unknown`, received `ok`**. Uncertainty was preserved in the report and then discarded
at the decision that needed it.

This policy began with `computeVerdict` in **8215d60f60**, “The page shows what a blocked session is
asking, and pushes it live”; admission first reused it in **a59d65cbd4**, “A New session button's
route, and the fields a reboot needs”. **3666e3979** moved admission onto the cached report while
retaining this defect, despite [plan-review F2](../plans/261004c-review-1-gpt-sol-on-the-plan.md).
Moving collection out of the request removed one source of overlapping probes, not the partial
evidence that an owned-child refusal can still produce.

**F11, continuity of waits.** `attentionRunner` mapped both a missing generation and a mismatched
before/after bracket to `${instance}:tmux-unknown`. `memoryForEpoch` carries waits when strings
match, so two failures asserted continuity exactly like two successful reads of the same server.
Two null/null passes and successive brackets 7/8 then 8/9 both retained `waitingSince` when the
reviewer's regression required it to restart. Verdicts about unchanged text should survive;
durations attached to a continuously observed session should not.

Both regressions failed with **expected `['2026-10-04T12:00:00.000Z']` to not deeply equal
`['2026-10-04T12:00:00.000Z']`**: a minute-later pass preserved the earlier wait.

The shared unknown epoch began in **2f849e7ba3**, “The attention inbox's deciding half: what needs
Greg, and how we know”. **3666e3979** correctly bracketed the awaited listing, but introduced
mismatched brackets as another path into that inherited unknown-equals-unknown defect.

## Why the checks agreed

The health tests covered freshness and fully readable reports, not the partial-refusal shape
already called out in F2. The attention tests checked a known generation followed by an unknown
one; the different strings reset waits and concealed the second unknown pass. Both suites tested
the change of state without testing whether the resulting state could support the next decision.

## The fix and the countermeasures, ranked by ease against value

1. **Exercise partial evidence and consecutive failures at the consumer.** Cheap regression
   cases now check actual admission and persisted waits, including paired cases that retain
   successful behaviour. The primary reviewer saw these fail before applying the fixes.
2. **Require the evidence needed by each decision.** The review patch makes any unknown core
   health field refuse admission, and drops waits on every unproven-generation pass while keeping
   text verdicts. This is the long-term boundary: severity and completeness, or identity and
   unknown identity, answer different questions. A shared presentation label cannot substitute
   for the missing evidence.
3. **Reject changing the health display to demand complete evidence.** That would hide a useful
   measured severity whenever an unrelated field failed. Admission can require more evidence
   than presentation without changing the collector's interpretation.
4. **Reject fresh subprocess surveys inside launch requests or invented random epochs.** The
   first restores the blocking work being removed; the second disguises the absence of a proven
   generation as an identity. Neither is needed to enforce the consumer's contract.

Investigation: 2026-10-04, source and git-history inspection in a read-only-code subagent; failing
regressions supplied by the primary reviewer. No code or test changes were made by this subagent.

Up: [Postmortems](../project/postmortems.md).
