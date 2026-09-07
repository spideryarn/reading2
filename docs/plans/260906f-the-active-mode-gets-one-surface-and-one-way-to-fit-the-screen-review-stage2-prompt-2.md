# Code review round 2: stage 2 of A5 — the eleven bands on `ModeSurface`

You refused round 1 with F25–F29 (no P0/P1) and said the runtime migration itself was correct.
**All five are accepted and fixed.** Round 1's prompt and your answer are on disk as
`…-review-stage2-prompt.md` and `…-review-stage2-sol.md`. Worktree:
`/home/greg/code/spideryarn2/.claude/worktrees/a5-mode-surface`.

**This is the last round** — the process here is two rounds, then I settle it and write any overrule
into the plan.

## What changed

**F25 — Quiz's trap is now pinned.** `QUIZ_NO_SUBMODE` in
`tests/mode-surface-changes-no-markup.test.tsx`, mounted from a `createElement(QuizPanel, …)` with
the prop genuinely absent, expecting `headChildren: []`. Watched: with Quiz changed to
`head={subMode}`, that one test goes red and the other 31 stay green.

Worth knowing, because it is the kind of thing you have caught me on before — **my first attempt at
this test was wrong and passed**. I added a `subMode` parameter to `mountQuiz` with a default, and
called it as `mountQuiz(QUIZ, undefined)`; a JS default parameter is selected *by* `undefined`, so
the panel got the default control and the shape I pinned was the wrong one. The test failed on the
literal and I rewrote it as a mount of its own. **Please check the replacement is actually testing
what it says**, since the first one was not.

**F26 — `new-mode.md` rewritten.** It no longer says "any conditional header child requires a
fragment". It now poses the question: a row that must persist while its contents come and go takes an
always-present fragment; a header that genuinely should not exist in a state takes the conditional
directly and draws no row. It also now says four bands empty *while loading*, plus Diagram's ordinary
state.

**F27 — both files are tracked** and are in the pending commit, along with everything else in this
stage. I have stopped asserting "untracked: nothing" and checked instead: `git status --porcelain`
currently shows only modified tracked files plus this prompt and the round-1 prompt/answer pair.

**F28 — Diagram's comment corrected.** It now says the conditional form would remove only the empty
row in the no-caveat states, not that it would undo the 2026-08-30 fix, and says the fragment is
right because this stage preserves the DOM the band already had.

**F29 — inventory corrected** in the plan (two preview files, named, with why the other three are not
in the list), in the oracle's describe title, and in `preview-diagram-wait.tsx`'s own comment.

**Also, three source-reading tests broke on the migration and were repaired**, which round 1 did not
see because they were not in the files you were pointed at: `tests/referee-band-fits.test.ts` (two
regex slices over `App.tsx`, updated separately and deliberately so) and
`tests/referee-how-card.test.tsx` (anchored on `className="band-head"`, which `ModeSurface` now
writes instead of `App.tsx`). **Check those three repairs are honest** — that the new anchors are as
strong as the old ones and cannot slice from `-1` and silently test the whole file. I added an
explicit "the band exists at all" assertion to the `referee-how-card` one for that reason.

## What I want from you

1. **Are F25–F29 fixed, and did any fix introduce something else?** Weight F25's replacement test and
   the three repaired anchors highest — those are where I could most easily have written something
   that passes without checking anything.
2. **Is the oracle now sufficient** to be the standing guard for these twelve bands? If there is a
   class of DOM change it still cannot see, name it. This is the last round, so this is the last
   chance to say so.
3. Anything new in the revised files, including prose that overclaims. Five of your findings across
   the stages have been comments asserting things the code did not do.
4. Anything about stage 3 (A6, Escape) that this stage has made harder or easier — it is next, and
   its inventory is at `…-escape-inventory.md` if useful.

## State of the checks

- `npm run typecheck` green. The oracle 32, the circuit breaker 3, `referee-band-fits` 7,
  `referee-how-card` green, `every-mode-draws-its-surface`, `a-broken-mode-leaves-the-article-readable`,
  `outline-panel`, `public-network-trace` green.
- Full `npm run check` re-running as I send this against the final tree; the previous run was
  14,145 passing with the three failures named above, two of which were mine and are fixed.
- One failure is **not mine** and is red on `origin/dev` itself:
  `docs/plans/260906a-labels-leave-the-blocking-hierarchy-step.md` links to
  `tests/shared-site-run-row-gate.test.ts`, which does not exist (commit `01459af6`, another agent's
  job). I have left it alone.

## Ground rules

- **Check claims against the source**; say **established** or **reasoned**.
- Severity P0/P1/P2/P3, IDs continuing from F29 — start at **F30**.
- A clear verdict: accept, or refuse as written.
- Out of scope: the viewport fit arithmetic (stage 4, blocked on a device trace that does not exist
  yet), stage 3, and the mobile redesign.
