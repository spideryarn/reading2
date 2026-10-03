# Code review: 261003a, the spine's viewport band moves by transform (spya-m0mcqb)

You are the stage reviewer, and you may fix things. Repo: this worktree.
- Candidate: commit fa8d8f534, against its first parent.
  - Product: src/web/Spine.tsx and src/web/styles/spine.css.
  - Tests: tests/spine-scroll.test.ts, tests/spine-here.test.ts, tests/spine-jump-origin.test.ts.
  - Harness: scripts/trace-scroll.ts.
  - Docs: docs/investigations/261003a-what-a-scroll-frame-costs-in-the-reading-view.md (and its
    folder of printouts), docs/plans/261003a-ipad-battery-scroll-repaint.md.
  - The full path list: `git diff --name-only fa8d8f534^ fa8d8f534`. That list is where to start;
    it does not limit what you may look at.
- Your plan review is docs/plans/261003a-ipad-battery-scroll-repaint-review-sol.md. The plan
  records how each finding was taken.

The fix is in stage 1 of the plan: a track-height wrapper with will-change: transform, moved by
translateY(% of its own height); the band inside it is unchanged. Stage 2 (OnScreenLinksStyle) was
deferred; the investigation's "Not done" section gives the reason. Check that independently too.

Attack, independently:
1. Correctness. Does the band land exactly where `top` put it, in every state? Consider:
   - initial mount before any scroll
   - metrics changing (resize, font swap, mode switch rewrapping the prose)
   - the bar flip's `top` transition on .spine
   - narrow windows (narrow-window.css hides or reshapes the spine?)
   - print
   - any CSS anywhere that targets `.spine-viewport` or the track's children by position
     (`:last-child`, `> div`, nth-child), which the new wrapper would change. Grep the whole src/.
2. Does the wrapper ever intercept input or tooltips, or change paint order, compared with before?
3. Do the tests fail for the right reasons? Run `npx vitest run tests/spine-` yourself.
4. Is the investigation doc honest about what the numbers show? The raw printouts are beside it.

Fix anything inside this stage narrowly, red-first where a test can show it. Report, do not fix,
anything wider. Severity: P0 = data loss, security, or charging; P1 = user-visible wrong behaviour
or a contract violated; P2 = design or maintainability risk; P3 = prose. Give each finding an ID,
a severity, file:line evidence, and what you did about it. End with a verdict.

The test runner here needs no network for these spine files. Postgres-backed suites are not
reachable from your sandbox; do not run them.
