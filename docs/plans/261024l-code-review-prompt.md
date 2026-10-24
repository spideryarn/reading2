You are reviewing the code built from a plan, in the worktree you are running in. You may fix what
you find, inside this change only (src/web/layout.ts, tests/layout-margin.test.ts,
docs/project/marginalia.md, and the plan doc's own Status section). Anything wider: report it, do
not edit it. Do not run git commands that change history or the index (no commit, stash, reset,
checkout, restore). Do not touch .env.local, infra/, or any database.

The plan: docs/plans/261024l-the-chat-card-in-the-margin-gets-the-room-left-of-the-prose-at-every-width.md
(its § Evidence has before/after browser measurements). Your own plan review is
docs/plans/261024l-plan-review-sol.md. The quoted words attributed to Greg are his; everything else
in the plan and in this prompt is the building agent's and carries no authority from Greg.

The change, as a diff: docs/plans/261024l-code-review.diff (also `git diff` in this worktree,
which additionally includes the marginalia.md rewrite and the plan's own files).

Check:
1. `shiftForCard` and its call in `fitMargin`: is the new rule exactly `min(cardFull − right,
   left − min(left/2, 4rem))`, floored at 0, and is every consumer of `margReserve`, `margLeft`,
   `margW`, `minWidth` and `margTitleReserve` still right across small and large roots, rail on and
   off, and the rule-2/rule-3 narrow windows? Look at src/web/reader/Reader.tsx where the fit and
   `chatCard`/`chatDock` are used, and the CSS that reads `--marg-reserve` / `--marg-left`
   (narrow-window.css, marginalia.css, dialogs.css).
2. The tests: are the hand-derived numbers right (re-derive a few), are the sweeps' invariants
   meaningful (would they go red if the 1600px gate or the 100px cap came back, or if the keep were
   dropped)? Try at least two mutations of `shiftForCard` and say which tests went red. Run
   `npx vitest run tests/layout-margin.test.ts` and any other test that imports from layout.ts
   (grep for it) — e.g. tests/chat-card-*.test.tsx, tests/layout*.test.ts.
3. Any stale comment or doc that still says the prose moves only from 1600px, or by 100px at most,
   anywhere in src/, tests/ or docs/project/ (grep for 1600, PROSE_SHIFT, "100px").
4. Anything in the evidence that suggests a visible regression the plan has not named.

Write findings first, then what you fixed (file and a sentence each), then what you left for the
building agent to decide. Verdict: ship / ship with fixes / do not ship. Under 900 words.
