# Narrowly scoped check: does the F4 fix close the false-deferral path?

**This is not a new review round.** Discovery is closed. You raised F4 as an established P1 in both
round 1 and round 2 of this plan, and its final fix was not in the round-2 snapshot you saw, so it
gets one scoped check of that fix and nothing else.

## The candidate

Repo root: `/home/greg/code/spideryarn2/.claude/worktrees/a7-annotation-measure`.
Base SHA `6eecb377f24d92446086a006d5b3103daae40aef`. Still no code committed.

Read `docs/plans/260905i-measure-annotation-computation-before-optimising-it.md`, specifically
**§ Stages — Stage 1a, Stage 1b and Stage 1c**, and **§ Decision rule**. Your round-2 answer is at
`docs/plans/260905i-plan-review-sol-r2.md` if you want to check yourself.

## The fix, as applied

Your round-2 note said: "make the expensive cohort conditional. Measure the real 551-block article
first. If it crosses a threshold, proceed immediately. Only if it would otherwise defer, seed one
long local article with dense, overlapping marks and time it in the production browser."

That was taken literally. The stage split into three:

- **1a** — inclusive memo timers only, production build, real 551-block article, glossary press
  first as the clean `proseHtml` probe, then comment open/close, then a streamed answer. This alone
  can end the job in either direction.
- **1b** — conditional and skipped if 1a decides. Seed **one** long local article with dense,
  overlapping comment and glossary marks and re-time. The general clone-and-remap framework is cut.
- **1c** — the prop-transition regression bench, counts only, never a decision number.

The other round-2 findings were also applied: F3 (median of five warmed repetitions, 30% clause
cut), F7, F10, F11, F12, F13. You may confirm those in passing but they are not what this check is
for.

## The only question

**Can the plan as it now stands still reach a "defer" verdict without having timed a workload heavy
enough to justify it?** Specifically:

1. Is the 1a → 1b trigger stated precisely enough to fire? It fires when 1a "would otherwise
   defer". Is that unambiguous, or can it be read as optional?
2. Is "seed one long local article with dense, overlapping marks" specified well enough that the
   seeded workload is actually heavy — enough comments, enough glossary occurrence blocks, real
   overlap — or could a thin seeding satisfy the letter and reproduce the false defer?
3. Does anything else in the revised text let the job stop early with a comfortable number?

If the answer to all three is that the path is closed, say so and stop. If not, give the smallest
correction, reusing **F4** as the ID.

Do not raise new findings on other subjects; discovery is closed and this check does not reopen it.
Finish with a one-line verdict: F4 settled, or F4 still open.

You have no network. Do not change any file.
