# Review, round two: the revised plan for sweep cluster 5

Repo: this worktree, branch `worktree-sweep5-c5-failed-read`. **Read-only: change no file.**

## The candidate

Live pre-commit: base `ab8289e2a`; untracked:
`docs/plans/261004c-sweep-cluster-5-a-failed-read-can-be-retried-and-says-a-readers-sentence.md`
(revised), your round-one review `docs/plans/261004c-sweep-cluster-5-plan-review-sol.md`, and the
two prompts. No code is changed yet.

## What changed since round one

The plan's § "Sol's plan review, round one" is the ledger: F2–F8 accepted and written into stage 1
(F4, F7) and stage 2a/2c (F2, F3, F5, F6, F8). F1's facts are accepted and its remedy overruled
after an Opus arbitration — the plan's § F1 has the reasoning and what is built instead.

## What I want

A narrow check, not new discovery of the whole area:

1. Is each of F2–F8 actually closed by the revised text? In particular stage 2a's hold: is the
   statement "the hold is released only by (1) a fresh read with a different identity, (2) a known
   failed/cancelled job, (3) a fresh read that started after the band saw the queue idle; fresh =
   started after the mark and not an offline copy" **accurate and sufficient** against
   `useOrderedRead.ts`, `useStepJob.ts`, `lib/api.ts` (offline copy) and the six hooks? Can it get
   stuck held for ever in a reachable case (that would be a P1 the other way)?
2. Is the F1 overrule sound, given `useAutoRun.ts`'s header? If you still hold it is a P1, say what
   direct evidence makes it wrong behaviour rather than the documented rule.
3. Anything in the revision that is false about the code.

Same severity scale (P0–P3), same refusal bar (established P0/P1 only). Continue the IDs from F9.
End with one line: PROCEED, PROCEED WITH CHANGES, or REFUSE.
