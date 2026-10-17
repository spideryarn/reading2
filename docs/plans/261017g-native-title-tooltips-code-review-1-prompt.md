Code review of stage 1 of docs/plans/261017g-native-title-tooltips-become-rich-cards-everywhere-and-a-test-keeps-it-that-way.md, in this working tree. READ-ONLY: other agents are editing files in this tree right now (the stage 2 sweep), so do not edit anything; report findings and the exact fix for each.

The diff to review: `git show 34c48075b` (commit "261017g stage 1: one page-wide card for data-tip"), plus the uncommitted changes to: src/web/cost-charts.tsx, scripts/cost-analysis-chart.ts, src/web/AdminCostsPage.tsx (one line), tests/cost-charts.test.tsx, src/web/SourceLink.tsx, src/web/PdfFigureNote.tsx, src/web/Link.tsx, src/web/components/ui/button.tsx, tests/no-native-title-tooltips.test.ts. Read them with `git diff HEAD -- <file>` (ignore other files' uncommitted diffs: they are the sweep, in progress).

Your plan review is docs/plans/261017g-native-title-tooltips-plan-review-sol.md; the plan's section "After GPT Sol's plan review" says what was taken from it.

Look especially for:
1. Behaviour BlockLinkCard.tsx had before the refactor (see `git show 34c48075b^:src/web/BlockLinkCard.tsx`) that it lost or changed: the reading-time line's press, its re-entry repositioning, the tapped close-on-scroll, the index refresh, aria-describedby rules, Escape, the dialog portal root, the fade-out content.
2. Bugs in src/web/useDelegatedCard.tsx: stale closures through specRef, timer races between hover and openNow, the reword observer, `controls` identity, cleanup.
3. TipCard.tsx: the ignore rule (Tooltip triggers via data-tooltip-trigger, block-card triggers), describes, paragraphs; anything in main.tsx mounting it outside App that could break (SSR? the landing page? the eager-client graph?).
4. Escape: is consuming it only for a tip inside `.tooltip-anchor` right, and does the capture listener interact badly with Dock's window-capture listener, useEscapeToClose, or native dialogs?
5. The guard test (tests/no-native-title-tooltips.test.ts): false negatives/positives, the SVG ancestry rule, the spread detection.
6. cost-charts: both modes correct, the static report unchanged.
7. Tests: are tests/tip-card.test.tsx and tests/gutter-control-card.test.tsx asserting the right things, and can each fail?

Run the tests if useful (`npx vitest run tests/tip-card.test.tsx tests/gutter-control-card.test.tsx tests/block-link-card.test.tsx tests/cost-charts.test.tsx`), but not the full suite.

Write a verdict and numbered findings, each with file:line, severity, and the fix.
