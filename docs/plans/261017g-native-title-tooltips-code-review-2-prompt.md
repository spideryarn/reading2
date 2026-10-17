Code review 2 of docs/plans/261017g-native-title-tooltips-become-rich-cards-everywhere-and-a-test-keeps-it-that-way.md, in this worktree (it is this task's own; nobody else edits it). You may edit: fix what you find inside this stage, keep each fix small, and report anything wider for me to decide rather than building it. Do not commit; I read your diff, run the gates and commit.

The diff to review: `git show ab7c2a321` (stage 2: the sweep of about 190 native `title` tooltips in src/web to `data-tip`, the guard test, and the fixes for your code review 1, docs/plans/261017g-native-title-tooltips-code-review-1-sol.md). Stage 1 (`git show 34c48075b`) is the card itself and was your review 1. The plan's "Results" section says what each stage did and what was decided.

Evidence: `npx vitest run tests/no-native-title-tooltips.test.ts` is green with 0 hits; `npm run typecheck` is clean; the 17 tests that mock Tooltip.js, plus tip-card, gutter-control-card and reading-time-card, pass (240 tests). The full suite is rerunning now; an earlier run's failures included tests whose `vi.mock("../src/web/Tooltip.js")` lacked `DELAY`, fixed by moving it to src/web/tooltip-delay.ts.

Look especially for:
1. Accessibility lost in the sweep: a `title` that was an element's only accessible name (an icon-only button or link, an image-like span) now with `data-tip` and no `aria-label`/text; or `data-tip-describes="off"` where the tip carries information the name does not.
2. Mechanical slips: `data-tip` on a React component that does not forward unknown props to the DOM (so the tip silently vanishes), a `data-tip={undefined-or-empty}` that used to be a meaningful title, a renamed prop (`tip`, `armedTip`, ThresholdSlider's `tip`, StopBar, ORDER_OPTION) with a caller still passing the old name.
3. Tests changed from `title` to `data-tip` assertions: any that became vacuous (asserting absence of something that can now never be present) when they used to guard something real. Some are known (quiz-in-prose:416, sketch-caption:241, tweets-copy-icons:107, shelf-table-row-card); say whether any is worth repointing.
4. The guard (tests/no-native-title-tooltips.test.ts): false negatives on shapes that exist in src/web today, and whether the allowlists are as tight as they can be.
5. Search's find button now uses `aria-disabled` instead of `disabled`: is every path that used to be blocked by `disabled` still blocked (Enter in the field, form submit, the keyboard shortcut)?
6. cost-charts `tips` mode and its two callers.
7. The DELAY move (src/web/tooltip-delay.ts, Tooltip.tsx, useDelegatedCard.tsx).

Run focused tests as you like, but not the full suite (the box is shared and one is already running).

Write a verdict line ("Verdict: ...") and numbered findings, each with file:line, severity, whether you fixed it, and the fix.
