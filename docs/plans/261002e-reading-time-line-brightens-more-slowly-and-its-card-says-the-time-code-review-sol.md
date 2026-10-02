No functional correctness defects remain in the scoped change. I made no commit.

Findings:

- P2 — fixed: lifecycle regressions were not covered at [useReadingTime.ts:340](/home/greg/code/spideryarn2/.claude/worktrees/fb9n-reading-marks-brighten-slower/src/web/useReadingTime.ts:340) and [BlockLinkCard.tsx:171](/home/greg/code/spideryarn2/.claude/worktrees/fb9n-reading-marks-brighten-slower/src/web/BlockLinkCard.tsx:171). A retained lookup could expose the previous article after unmount, or an open card could retain its time after recording ended, without failing the original suite. Added tests at [use-reading-time.test.tsx:474](/home/greg/code/spideryarn2/.claude/worktrees/fb9n-reading-marks-brighten-slower/tests/use-reading-time.test.tsx:474) and [reading-time-card.test.tsx:205](/home/greg/code/spideryarn2/.claude/worktrees/fb9n-reading-marks-brighten-slower/tests/reading-time-card.test.tsx:205). Both were mutation-checked.

- P3 — fixed: [reading-time.ts:42](/home/greg/code/spideryarn2/.claude/worktrees/fb9n-reading-marks-brighten-slower/src/web/reading-time.ts:42) and [reading-time.md:31](/home/greg/code/spideryarn2/.claude/worktrees/fb9n-reading-marks-brighten-slower/docs/project/reading-time.md:31) inaccurately said each incremental step costs twice as much and that a second read reaches full strength. The thresholds double, but level 4 starts at 2.8×. Corrected the code comments, plan, documentation, and wrong plan link.

- P3 — fixed: the original boundary tests allowed small threshold drift; for example, changing 0.35 to 0.351 still passed. Exact 0.35/0.70/1.40/2.80 cases were added at [reading-time.test.ts:51](/home/greg/code/spideryarn2/.claude/worktrees/fb9n-reading-marks-brighten-slower/tests/reading-time.test.ts:51) and mutation-checked.

- P3 — not fixed, wider than the commit’s files: [gutter.css:975](/home/greg/code/spideryarn2/.claude/worktrees/fb9n-reading-marks-brighten-slower/src/web/styles/gutter.css:975) still says a glance “barely shows,” and [spine.css:130](/home/greg/code/spideryarn2/.claude/worktrees/fb9n-reading-marks-brighten-slower/src/web/styles/spine.css:130) says scrolling past produces a sliver. Under the new 0.35 threshold, an ordinary glance draws nothing. These are comments only; the runtime CSS is correct.

P0/P1: none.

Verified:

- Spine widths remain 25/50/75/100%; gutter opacity remains .05/.15/.30/.50.
- Quiz “read” remains exactly 0.70 via `READ_ENOUGH = 2`.
- Both `contentFor` calls, its refresh effect, `readingRef`, block keying, and owner-only Reader wiring are correct.
- `spentWords` and card live updates are correct.
- Focused tests: 5 files, 135 tests passed.
- Scoped Biome lint and `git diff --check` passed.
- `npm run typecheck` itself was blocked by the sandbox denying `tsx`’s `/tmp` IPC socket. Running the identical wrapper as `node --import tsx scripts/typecheck.ts` passed all four projects and covered all 2,692 source files.

Untracked concurrent artifacts remain untouched.