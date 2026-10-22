VERDICT: ship after fixes (applied)

1. [spine.css:66](/var/tmp/spideryarn-worktrees/fbwzssyu-spine-visible-part/src/web/styles/spine.css:66) — under `prefers-contrast: more`, two 2px borders made the viewport’s minimum used height 4px while the veil gap remained 2px. Added a shared `--spine-view-floor`: 2px normally, 4px in increased contrast. Both viewport and veil now use it. Added the regression at [spine-bottom.test.ts:35](/var/tmp/spideryarn-worktrees/fbwzssyu-spine-visible-part/tests/spine-bottom.test.ts:35), observed failing before the fix.

2. [granularity-zoom.md:547](/var/tmp/spideryarn-worktrees/fbwzssyu-spine-visible-part/docs/project/granularity-zoom.md:547), [performance.md:695](/var/tmp/spideryarn-worktrees/fbwzssyu-spine-visible-part/docs/project/performance.md:695), [spine.md:8](/var/tmp/spideryarn-worktrees/fbwzssyu-spine-visible-part/src/web/help/pages/spine.md:8) — corrected stale descriptions saying the rail fills the whole viewport and that its band still moves via `top`. Updated related comments and regenerated the Help corpus.

Bottom-geometry audit found no further defect: no JavaScript assumes the old rail foot; key navigation and hover cards use live element rectangles; narrow-window CSS only adds the reduced-motion override. The spine now uses exactly the mode band’s bottom formula and motion semantics. Light plus `prefers-contrast: more` correctly resolves to 60% because the equally specific light rule appears inside the later media block.

Verification:

- Focused suite: 164 passed, 1 skipped.
- Typecheck: all four projects passed; all 3,930 source files covered. The literal npm wrapper could not create `tsx`’s Unix socket in this sandbox, so the same script was run via `node --import tsx`.
- `git diff --check`: passed.
- Touched-file lint: only two pre-existing `!important` warnings in `tooltip.css`.