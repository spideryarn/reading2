Findings:

- Low — [src/feedback-question-values.ts:111](/var/tmp/spideryarn-worktrees/qi7j8d72p9-repeat-covered-by-question/src/feedback-question-values.ts:111), [src/routes.ts:8898](/var/tmp/spideryarn-worktrees/qi7j8d72p9-repeat-covered-by-question/src/routes.ts:8898), [src/types.ts:8145](/var/tmp/spideryarn-worktrees/qi7j8d72p9-repeat-covered-by-question/src/types.ts:8145): comments incorrectly implied `report` never reaches the browser and omitted that `repeats` becomes only the per-row `asked` flag. This could mislead a later wire-shape change. Fixed.

- Low — [src/types.ts:8073](/var/tmp/spideryarn-worktrees/qi7j8d72p9-repeat-covered-by-question/src/types.ts:8073), [tests/feedback-route.test.ts:732](/var/tmp/spideryarn-worktrees/qi7j8d72p9-repeat-covered-by-question/tests/feedback-route.test.ts:732): duplicated field counts were stale—the test claimed eleven fields although the row has twelve. Fixed by removing the brittle counts while retaining the exact-object assertion.

- Low — [scripts/feedback-endings.ts:47](/var/tmp/spideryarn-worktrees/qi7j8d72p9-repeat-covered-by-question/scripts/feedback-endings.ts:47): compiler documentation omitted `repeats` from the generated open-question data. Fixed.

No runtime correctness bugs or missed consumers found.

Files changed:

- `scripts/feedback-endings.ts`
- `src/feedback-question-values.ts`
- `src/routes.ts`
- `src/types.ts`
- `tests/feedback-route.test.ts`

Checks: 4 requested test files passed, 481 tests total. The literal `npm run typecheck` wrapper was blocked by sandbox IPC permissions; its underlying checker passed all four TypeScript projects and all 3,757 source files. Generated files are current. Scoped lint passed with seven pre-existing complexity notices in `src/routes.ts`.

VERDICT: ship-after-fixes-applied