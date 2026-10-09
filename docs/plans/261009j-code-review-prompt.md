You are reviewing code before it is pushed, in the Spideryarn repo (the current directory, a git worktree). You may edit files to fix what you find, inside this change's scope only; report anything wider for the author to decide. Do not run git commands that change history (no commit, reset, checkout, stash, rebase). Do not touch .env*, infra/, or any database.

The change: docs/plans/261009j-skim-question-optional-and-the-border.md (read § Outcome first, then § The change). Your earlier read-only review of the plan is docs/plans/261009j-plan-review-sol.md; check each of its ten findings was actually addressed in code. The scoped diff is docs/plans/261009j-code-review.diff (also: `git diff 043acdd49 HEAD -- src tests scripts`). The measurement it rests on is docs/investigations/261009b-skim-cue-optional-eval.md — read it critically: does it say honestly what the numbers show? Fix wording there if it overclaims.

Look hard at:
1. src/skim.ts: `cueOf`/`validateRoute`/`emptyDrops` — every path an empty, whitespace, non-string, over-long cue takes; `noCue` vs `badCue`; the prompt section 3 (contradictions with the rest of the prompt, the PLAIN WORDS section, the OUTPUT example, the strict JSON schema).
2. src/web/SkimPanel.tsx: the `Tooltip` around the `.skim-cue` span inside the row `<button>` that is itself inside a `Tooltip` — props, refs, aria, nested floating behaviour, `TooltipGroup`; that the (i) card shows `SKIM_CUE_EXPLAINED` for owner and visitor. Add a test in tests/skim-panel.test.tsx if the explanation in the (i) card or the cue's card is untested.
3. src/web/styles/skim.css: the one-bar rules (`.skim-row.current`, its `::before`, the neutralised child hover; `.skim-card` no longer painting), stacking against `.skim-where` and focus rings; the door now sized by `.prose`'s measure in `--font-author` (compare src/web/styles/prose.css and quiz.css `.quiz-in-prose`), and `.skim-door > *` back in the UI face against src/web/styles/voices.css specificity for `.skim-door-cue-next`.
4. scripts/eval/skim-cue-optional-pairs.ts: correctness of the common-population filter, the key/judgment join, the sign test, the per-arm flag counts (does "left out — needed" count only pairs where the other side had a cue? say so in its header if so).
5. tests/type-roles.test.ts exception entry and the CSS comment it requires; docs/project/typography.md and skim.md say the same.
6. Anything else that reports success while doing nothing.

Then run `npx vitest run tests/skim.test.ts tests/skim-panel.test.tsx tests/type-roles.test.ts tests/help-corpus.test.ts` and `npm run typecheck`, and make them pass.

Write your answer as numbered findings: severity, what, evidence (file:line), and what you changed (or why you left it). End with one line: "Verdict: push" or "Verdict: do not push" and why.
