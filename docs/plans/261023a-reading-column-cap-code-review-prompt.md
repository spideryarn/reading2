Code review of plan docs/plans/261023a-reading-column-cap-a-middle-value.md, built, uncommitted, in this worktree. The diff is docs/plans/261023a-reading-column-cap-code-review.diff (`git diff HEAD`, plus the new plan files that are untracked). Your plan review is docs/plans/261023a-reading-column-cap-plan-review-sol.md.

What changed: `PROSE_ALONE_MAX_REM` 49 → 42 in src/web/layout.ts. The wide band's lower bound is now `max(standard, spare)`. `spareBeyondTheMeasure` takes the spare against `max(proseAloneMaxPx, PROSE_MIN)`. The hand-derived test numbers were re-derived in tests/layout*.test.ts, chat, structure-band-width, gutter-target-size and text-alone-centring. Two `it.fails` "under a rem of slack" tests became ordinary "no more than 10rem of slack" tests. scripts/measure-line-length.ts gained 1194 and 1440 Large/Larger/Largest windows and now launches without `--hide-scrollbars`. Docs were corrected.

You may fix what you find, inside this change's scope (layout.ts, those tests, that script, those docs). Do not commit, and do not run git commands that discard work. Write your findings to the output file BEFORE making any fixes, then add a section listing each fix you made, file:line.

Check in particular:
1. Each re-derived test number: is the derivation in its comment right, and does the test still test what its name says? Look hard at tests whose window or root was moved (e.g. 700→680, 1100→1080, 24px→28px root, roomy(1000,12)→roomy(970,13), 1920→1800, 1165→1108). A moved input can quietly stop exercising the case the test exists for.
2. Would each new or rewritten invariant test have been red before its fix? The PROSE_MIN test in tests/layout.test.ts ("never widens by taking the prose below PROSE_MIN"); the "holds its invariants" wide ≥ standard check; the 10rem slack tests at a cap of 49.
3. The layout.ts comments: are the numbers in them now true (1109, 1157, 1252, 1213, 1800/58px, 1916, 696/870/528, 486/496/502)?
4. Anything else that reads proseAloneMaxPx or the cap and now behaves differently: fitMargin, fitBoth, chatCard, chatDock, shiftForCard, Reader.tsx, CSS.
5. Run `npx vitest run tests/layout.test.ts tests/layout-margin.test.ts tests/text-alone-centring.test.ts tests/gutter-target-size.test.ts tests/prose-centred-in-its-cell.test.ts tests/structure-band-width.test.ts tests/chat.test.ts tests/spine-width.test.ts` and `npm run typecheck`, and report the results.

Verdict first (ship / ship with fixes / no), then numbered findings with file:line and a concrete failure scenario. Be brief.
