# 260930i code review — GPT Sol (gpt-5.6-sol, high, workspace-write)

Reviewed commit `2255f2e3`. Exit 0. **Verdict: approve with the fixes; no wider blocker found.**

Sol's final message overwrote the numbered report it had written to this file, so this record is the
author's, from its closing summary and its diff (which is the second commit of this stage):

1. **P1 — the read filter could overrule an arrival for the same unread opening question.** On
   mount, with *Only what I've read* on and question 1 unread, the filter effect moves 0 → the first
   read question in the same commit in which the arrival turns the filter off and asks to stay on 0;
   the arrival's "already open, don't move" guard then wrote nothing, so the filter's move won. Fix in
   `QuizPanel.tsx`: on the stay-put branch, write `setAt(to)` and `setArrivedByNext(false)` without
   `move`, so the arrival is the last writer and a live mark and draft survive. New test *"wins when
   the filter tries to move off that same unread opening question"* — seen red by the author with
   the two lines removed, green with them.
2. **P2 — `QuizInProse` used a native `title`**, which [tooltips.md](../project/tooltips.md) forbids
   (a hover-only second sentence a finger never reaches). Removed; the visible question is the
   button's name. `quiz-in-prose.test.tsx` now asserts there is no `title`.

Sol's verification: 8 scoped files, 202 tests passed; a visitor deep-link check (no quiz reaches a
visitor); typecheck across the tree; scoped Biome and `git diff --check`.
