# A typed entry point skips the hold the button has

The command bar's *Run again* row could start a second paid run of a mode whose forced re-run was
still held: with FAQ's rewrite finished and its result GET in the air, typing `rerun faq` posted
another `{ force: ["faq"] }` while every control in the band stayed disabled. Found by GPT Sol's
code review of [261007b](../plans/261007b-seventh-sweep-rewrite-hold-on-the-six-forced-verbs-without-one.md)
(C4), reproduced and pinned there; fixed in
[261007i](../plans/261007i-command-bar-run-again-row-honours-the-rewrite-hold.md). No reader impact
or charges were investigated. The reproduced window is the completion GET; a failed or offline
read, or a mode left closed after the job ends, can keep the hold up longer (rewrite-hold.ts).

## The class: a second entry point that skips a guard the first one has

The guard lived in the hook behind the button, so it guarded the button, not the action. Any other
way to the same POST had to know to ask, and the bar's row was written before there was anything
to ask. This is the second instance in one day:
[261007b's postmortem](261007b-an-alternate-paid-action-bypasses-the-completion-fence.md) is the
same class through `JobProgress`'s Retry. There the fix was to register the hold at the shared
seam; here the row is outside any mode hook, so it asks the hold's module directly.

## How it got in

The row arrived first: `ad2249afc` (2026-10-02, plan 261002c) gave the bar a *Run again* row per
Metadata step, posting the same body Metadata's row posts. Its reasoning was sound for its day —
it leaves for Metadata so that a mode's own auto-run cannot make a second job. The shared hold
arrived two days later in `fb514efd3` (plan 261004c) and was wired into mode hooks only, and
261007b extended it to thirteen. Neither change touched the bar, because the bar is not a mode.

## Why the checks agreed

The hold table presses each mode's own verb. The membership guard in
[rewrite-hold.test.tsx](../../tests/rewrite-hold.test.tsx) found `CommandBar.tsx` writing a
`force`, and it was excluded with a reason that was true about where the press lands and silent
about whether it should first ask. An exclusion list answers "is this file accounted for", not
"does this file honour the guard".

## The fix that holds beyond this instance

`rewrite-hold.ts` § `rewriteHeld(slug, step)` exposes the check `run` already makes, and the row
refuses with a sentence when it is true. No second mechanism: the same map, the same key, the same
epoch fence. The pinned test now asserts the refusal and was seen red against the unfixed row.

## What would have caught the class

1. **Name the action, not the control, when a guard is added**, and grep for every caller of the
   action's request builder (`stepRunRequest(…, { force: true })` here) before calling it done.
2. **Make an exclusion say whether the excluded file asks the guard.** The guard's `NOT_HELD`
   reason for the bar now does.
3. **Put the check on the shared path where one exists.** For Retry that was `useStepJob`; the
   bar's row goes through `useJobs().run`, which knows no artefacts, so it stays at the row.

Up: [Postmortems](../project/postmortems.md).
