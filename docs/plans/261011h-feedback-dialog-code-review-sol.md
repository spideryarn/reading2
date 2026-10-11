Reviewed and fixed two low-severity issues. No wider product defects found.

Cascade now behaves correctly in both themes:

- Rest/focus-visible: semantic selectors have specificity `(0,3,0)`, beating `.fb-copy`.
- Hover: `(0,4,0)`, beating `.fb-copy:hover` and `[aria-disabled]:hover`.
- Disabled: retains semantic colour/border while `.fb-reply-send:disabled` supplies only opacity and cursor.
- No other stylesheet names these button hooks; the global button reset is in a lower layer and does not override their colours.
- `--positive` clears 4.5:1 on all tested surfaces in both themes.

The new assertions would have failed against the parent sources: the 1280px rules, semantic classes/selectors, and `--positive` token were all absent. Strictly, `feedback-dialog-styles.test.ts` itself was newly added by the commit.

Verification:

- Targeted Vitest: 3 files, 384 tests passed.
- `npm run typecheck` was blocked before compilation by sandbox-denied `tsx` IPC. Running the same script directly with `node --import tsx scripts/typecheck.ts` passed all four projects and covered all 3,686 source files.
- Test-file lint and `git diff --check` passed.
- No commit made; unrelated existing worktree changes were untouched.

1. **Low — [feedback.css:403](/var/tmp/spideryarn-worktrees/fbtfp3zw-feedback-dialog-size-and-colours/src/web/styles/feedback.css:403) — fixed.** The original hover selectors tied the later `aria-disabled` hover selector, which would neutralise the colour if these controls adopted that convention. Added the existing `.fb-copy` class to make the semantic selectors decisively stronger.

2. **Low — [feedback-dialog-styles.test.ts:47](/var/tmp/spideryarn-worktrees/fbtfp3zw-feedback-dialog-size-and-colours/tests/feedback-dialog-styles.test.ts:47) — fixed.** `declared()` could accept a rule inside an unrelated at-rule and ignored competing selectors elsewhere in the cascade. The test now checks unconditional scope, the complete loaded reader stylesheet set, specificity, stylesheet ownership, and every paint declaration naming these hooks.

APPROVE WITH CHANGES (fixed)