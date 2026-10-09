Code review of plan docs/plans/261009m-skim-quieter-open-stop.md. The diff is docs/plans/261009m-skim-quieter-open-stop-code-review.diff (also the working tree). Your plan review is docs/plans/261009m-skim-quieter-open-stop-plan-review-sol.md; how its findings were handled:
- F1 (door selector): both the model's cue and the fixed "End of pass" line go upright, deliberately; the comment now says so.
- F2 (chip outline contrast): kept --rule-strong, as Greg's chosen option specified ("the stronger border colour"); screenshots docs/plans/261009m-shots/after-row-dark.png and after-row-light.png show the outline visible in both themes. Push back if you think this is wrong, but do not change the token.
- F3: added a cascade witness test for the open stop's heading (watched it go red with an overriding rule).
- F4: typography.md updated.
- F5: the quote marks were not kept.
Review for correctness: the cascade, light/dark, hover/focus states of the chip (is focus-visible still visible with transparent background?), docs accuracy, tests. Fix what you find inside this scope (skim.css, tests/type-roles.test.ts, docs/project/skim.md, docs/project/typography.md); report anything wider. Do not touch other files. Do not run the full test suite; `npx vitest run tests/type-roles.test.ts tests/skim-panel.test.tsx` is fine. Number findings, say what you changed.
