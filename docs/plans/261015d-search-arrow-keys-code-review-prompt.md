You are reviewing code in the Spideryarn repo (this working tree), and you may fix what you find.

The work: ← / → step Search mode's results list (Greg, 2026-10-15: "left/right keys should move
between search results in Search mode").

Read first:
- the plan and its post-review section: docs/plans/261015d-search-arrow-keys-step-the-results.md
- your own plan review: docs/plans/261015d-search-arrow-keys-plan-review-sol.md (finding 1, the
  history push, was deliberately kept for consistency with Quotes; 3 and 5 were declined — the plan
  says why. Do not reopen those unless you find a concrete bug the plan's reasoning missed.)
- the diff: docs/plans/261015d-search-arrow-keys-code-review.diff (src/ and tests/), plus the doc
  edits in docs/project/keyboard.md § ← / → in Search, docs/project/search.md § The mode band,
  src/web/help/pages/keyboard.md, src/web/help/pages/modes/search.md.

Then read the code around it: src/web/list-step.ts (new), src/web/reader/Reader.tsx (searchKeys,
bandJump), src/web/QuotesPanel.tsx (stepQuote, useFollowRow), src/web/SearchPanel.tsx (Results,
Hit, HitCard), src/web/keynav.ts (useArrowNav's horizontal seam and guards), and the tests
tests/list-step.test.ts and tests/the-marks-in-the-prose-belong-to-the-mode-showing.test.tsx.

Look for real bugs: a step that differs from a press on the row; the bandJump focus change
breaking anything else that calls bandJump (Skim? Citations? chat chips?) — check every caller;
useFollowRow's effect deps, the ref callback timing, a list element that unmounts and remounts
(Results has early returns), a ResizeObserver leak; the hook changing Quotes' behaviour in a way
that matters; jsdom-only assumptions; tests that could pass while the feature is broken.

Workflow:
1. FIRST write your findings to docs/plans/261015d-search-arrow-keys-code-review-sol.md: a
   numbered list, each with severity (P1/P2/P3), evidence (file:line), and what you did about it.
2. Then fix what is clearly right to fix, inside these files. Keep fixes small and in the style
   of the surrounding code. Run `npx vitest run <the test files you touched>` and
   `npm run typecheck`. Do not run the full suite, do not commit, do not touch git state.
3. Update the findings file with what you changed, and end it with a one-line verdict: APPROVE,
   APPROVE WITH CHANGES, or REWORK.
