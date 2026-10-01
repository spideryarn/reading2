Verdict: **land after fixes**. No P0/P1 findings and nothing wider to decide.

1. **P2 — Fixed:** clamped path titles used native `title` tooltips, inaccessible on touch and unreliable from keyboard. Replaced them with the app tooltip, reachable by hover, focus, and tap. The screen-reader separator now sits outside the clipped box. [AnnotationsColumn.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7m-7p-annotations/src/web/annotations/AnnotationsColumn.tsx:171)

2. **P2 — Fixed:** path tests only checked DOM shape; they did not pin grid rows, the two-line clamp, or the promised full-title card. Added coverage for all three. [annotations-head-path.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7m-7p-annotations/tests/annotations-head-path.test.tsx:33)

3. **P3 — Fixed:** the history-length assertion did not prove the combined write was atomic; a push followed by a replace could still pass. Added a test proving one Back restores `mode=glossary` with no intermediate `margin`. [every-mode-draws-its-surface.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb7m-7p-annotations/tests/every-mode-draws-its-surface.test.tsx:1512)

The Reader handler and `annotationsPress` need no changes: `wouldFit` has complete dependencies, the combined write closes the band atomically, `setBandAway(false)` is correct, the herald clears through the mode transition, and Trajectory is re-armed by its next direct press.

Checks:

- Requested Vitest command: **77 passed**
- Full typecheck: **passed**, all 2,541 source files covered
- `npm run typecheck` itself hit sandbox `tsx` IPC `EPERM`; running the same script via `node --import tsx` passed
- Touched-file lint: no errors; one pre-existing complexity advisory elsewhere in the large test file
- `git diff --check`: passed
- No commit made.