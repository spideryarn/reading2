# Recovery mode is not the lifetime of a pending command

Found in review on 2026-10-04, with fake-channel tests rather than a reported
reader incident. The evidence and runnable inputs are in the
[cluster 22 code review](../plans/261004e-sweep-cluster-22-code-review-sol.md).
Whether anyone experienced these sequences in production is unknown.

## The class: interaction mode mistaken for command lifetime

`e7873ccba` deliberately preserved a manual commit's pending flag when a late
entry refusal restored hands-free. That fixed one lost-answer path, but the
subsequent commit-refusal rule still interpreted hands-free as meaning no manual
commit was pending. A rejected turn retained reply debt; the next detector
commit consumed the stale flag and sent an unnecessary `response.create`.

The flag-survival defect was introduced by `e7873ccba`. The phantom-debt branch
and entry recovery's uncancelled tail predate it: tap-to-talk's timer and refusal
branch arrived in `815f9dc3a`. The new preservation also exposes a retry path
that starts a second manual turn before the preserved first one settles.

The root cause is the mismatch between two independent facts: how the reader
currently interacts with the call, and what asynchronous command the call still
owes an outcome for. Changing the first does not settle the second. A read-only
root-cause subagent independently traced these paths.

## Why the checks stayed green

The candidate's 125 tests in the two permitted files passed. Its table said no
mode besides Sending had a submitted turn, matching the caller's derivation
rather than the surviving pending flag. The late-entry regression ended at a
successful acknowledgement. It never tried rejection after recovery, or another
entry while that commit remained pending. The button/timer fix covered Ready
recovery from clear refusal, not hands-free recovery from entry refusal.

The new hook reproduction went red in two ways: a rejected commit produced
`no-reply`, and a later detector commit sent `response.create`. The retry-in-tail
test separately showed Ready while Talk did nothing.

## Corrections and the remaining class

The reviewer's scoped correction supplied the pending fact to the refusal policy and settled a
rejected commit while keeping hands-free. That fixed the two reproductions and left the retry path
(F3) and the two-reply-owners question (F4) open, both of them consequences of a manual commit
being awaited outside tap mode.

**What landed instead removes the state** (the implementer's decision after the review, checked by
a second review round). The entry refusal goes back to what it did before `e7873ccba`: it stops
waiting for the commit. So **a manual turn is only ever awaited in `tap-sending`**, the voice
detector is the only thing that asks for replies in hands-free, and a turn sent before a late
entry refusal is left visibly owed (`no-reply`, with Reconnect) instead of answered by us. Two of
the reviewer's corrections are kept: a commit refused in hands-free drops that debt, and every
refusal that changes anything cancels Done's tail. Both of its red-first tests pass unchanged.

### Round two: reply debt also survives the change of mode

**F5, established P1 against `677a2e1f6`; fixed uncommitted in round two.** A sent tap turn's late
entry refusal restores hands-free; its commit is acknowledged without our asking for a reply.
Another `speech_started`, held open for thirty seconds, offers Tap to talk again in the current
UI. Re-entry selects Ready, Talk sends a fresh clear, and that clear's refusal erases the earlier
accepted turn's reply debt. The hook test observed `stall: null` where `no-reply` was required.

This is not intrinsically a two-refusal or delayed-command problem: an unanswered hands-free
commit, followed by another open turn, first tap entry and a refused entry clear loses the same
debt. The unconditional Ready entry originated in `815f9dc3a`; `677a2e1f6` restores another way
to reach it. **The class is still interaction mode mistaken for outstanding work**, but the work
here is reply debt, not an awaited manual acknowledgement. A fresh buffer clear cannot reject a
conversation item that the service already accepted.

The narrow correction in `enterTapToTalk` chooses Sending when a reply is already owed. It adds
no manual acknowledgement or response owner. Talk waits; a clear refusal preserves debt;
`response.created` releases the wait, and commit rejection still settles a rejected manual turn.
Both new [hook tests](../../tests/live-session-flow.test.tsx) were seen red before this change:
the late-recovery retry and ordinary first-entry cases. The latter also verifies that a response
releases Talk. The two permitted files passed 128 tests afterward. Earlier entry tests began
without debt, and the late-recovery test ended before another entry. A read-only root-cause
subagent independently confirmed both paths and reviewed the correction.

Still open, and written down in the plan: provider error ids name a command kind, not the turn
that sent it, so a genuinely stale commit or response refusal can affect a later turn's debt.
Explicit turn ownership is the complete long-term fix; it is outside this stage. The entry guard
closes F5 without claiming to close that wider limitation.

## Countermeasures, ranked by ease against value

1. **Test the next outcome after recovery**, not just recovery itself. Cheap;
   applied for commit rejection and immediate retry. This tests surviving work
   under the new interaction mode.
2. **Use the actual pending-command fact at the boundary.** Cheap; applied for
   hands-free commit rejection. A UI label is not evidence that a command ended.
3. **Do not let the command outlive the mode that owns it.** Taken: recovery
   to hands-free abandons the awaited commit, so there is one fact, not two to
   keep in step. Cheaper than separating turn ownership from mode, and it
   gives up answering that one turn automatically. The reply debt still
   survives; round two makes tap entry respect it before offering Ready.
4. **A complete effect-language reducer for the whole hook.** Rejected for this
   stage. A bigger dispatch system does not establish ownership by itself, and
   adds machinery where explicit lifecycle facts and sequence tests suffice.

Up: [Postmortems](../project/postmortems.md)
