You are reviewing, and fixing within scope, a change in the Spideryarn repo, in this worktree.

Read docs/plans/261021f-nicer-ai-face-and-no-reader-font-setting.md (the plan, your plan review in
261021f-plan-review-sol.md, and its Progress), then the diff in docs/plans/261021f-code-review.diff
(also `git diff` plus the new untracked tests/self-hosted-faces.test.ts).

What it does: the model's face (--font-ai) goes from IBM Plex Mono to iA Writer Quattro for every
reader; code inside a model's answer gets --font-ai-code (iA Writer Mono) through a rule that ties
with the AI list in voices.css and comes after it; packages swapped; comments, docs and /design
updated; a new test that every face token's first family is declared by an imported @font-face, and
that the model's faces have the styles they are drawn in. Also one line added to
docs/reusable/ask-me-questions.md, which Greg asked for in his reply (quoted in the plan).

Check especially:
1. Does the code rule in voices.css actually win for code in chat and Candidates answers, and lose
   nowhere it should not? Verify specificity and source order concretely (consider other stylesheets
   that set font-family on .fmt-code / .fmt-pre code, e.g. mode-band.css, and their layer/order).
2. Anything else in src/, styles/, tests/ that still depends on Plex or on the AI face being a
   strict monospace (measurement in TS, `ch` units on AI-voiced elements, tests asserting family
   names).
3. Is tests/self-hosted-faces.test.ts sound — would it go red on the failures it claims, and is it
   brittle against Fontsource's CSS formatting?
4. Doc accuracy (fonts.md claims, the comments).

Fix what you find that is in scope, keep fixes small and in the surrounding style, run
`npx vitest run tests/self-hosted-faces.test.ts tests/voices-css.test.ts tests/type-roles.test.ts`
and `npm run typecheck`. Do not commit, do not run git commands that change history or the index.
Write findings numbered with severity (P1/P2/P3), what you changed for each, and anything wider
left for me, then a one-line verdict.
