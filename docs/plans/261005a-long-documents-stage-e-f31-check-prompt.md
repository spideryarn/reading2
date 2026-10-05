# Narrow check: is F31 closed?

Repo: this worktree, branch `worktree-long-documents-d-then-e`. Discovery is closed; this is a
check of one fix, not a new review.

## The candidate

Committed `6033b84c8`. `git diff 618ab1509..6033b84c8 -- src/structure-slices.ts tests/structure-slices-adversarial.test.ts`.

## The finding

Your second pass, `docs/plans/261005a-long-documents-stage-e-code-review-2-sol.md`, F31: admission
did not check whether a pending peer had already passed its own cap, so a re-ask could start after
a peer's cap when synchronous work carried the clock past it before the timer was dispatched.

The fix: `runSlices` tracks each active call's expiry, and admission refuses with `out-of-time`
(through the same path that stops further admission) when any active call is past its cap. One
existing F24 expectation changed from two started calls to one, with a comment saying why.

## What to do

Answer one question: **is F31 closed by this diff, without opening a new way to start a call
after an expiry, leave a timer armed, or miscount calls?** Re-run your `/tmp` regression against
the committed code if it still exists, and `npx vitest run tests/structure-slices-adversarial.test.ts`.
Say whether the changed F24 expectation is the right reading of the contract.

The tree is read-only. No network. Answer in under 250 words: closed or still open; if open, an
ID (F32 up), the input that shows it, and the smallest change. Use code spans for file paths. Do
not report anything outside this fix unless it is an established P0 or P1.

Do not change any file.
