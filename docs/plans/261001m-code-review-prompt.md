You are reviewing, and fixing, the code for one stage in the Spideryarn repo (this worktree).
The plan is docs/plans/261001m-citations-duplicate-by-line-and-a-flash-you-can-see.md — read it
including its Review log, which supersedes the earlier sections where they differ. The change is
commit a0bb4dc5: `git show a0bb4dc5`. Files: src/web/CitationsPanel.tsx (byLineRepeatsTitle,
byLineCard, byLineFolds, CiteTitle, ByLine), src/web/flash.ts (CITE_FLASH_MS), src/web/styles/prose.css
and tokens.css (the flash), tests/citations-panel.test.tsx, tests/block-flash.test.ts,
docs/project/citations.md. Context: src/web/useTapReveal.ts, src/web/Tooltip.tsx, docs/project/touch.md,
docs/project/tooltips.md.

Look for: correctness bugs (React hooks, the tap-reveal wiring on an <a> with target=_blank,
ctrl/middle-click, keyboard activation, aria-describedby content and duplication for screen
readers, whether a folded row with no card behaves right), false positives/negatives in
byLineRepeatsTitle, the flash timer vs CSS lengths, reduced motion, dark mode contrast of the
45% wash under the prose text colour, tests that could pass while the feature is broken.
Also check the conclusion: will Greg now see one line for "Bartlett (1932)" and notice the flash?

Fix what you find inside these files (keep the house style: comments explain intent; tests red-first
where practical), run `npx vitest run tests/citations-panel.test.tsx tests/block-flash.test.ts
tests/begin-jump-flash.test.ts tests/trajectory-panel.test.tsx` and `npm run typecheck`, and do not
commit. Report: a numbered list of findings (P0/P1/P2, file:line), what you changed for each, and
anything wider you did not fix.
