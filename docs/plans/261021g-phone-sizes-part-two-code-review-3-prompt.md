# Code review, round 2: 261021g stage 2 (narrow)

Candidate: commit `6a5e095ad` in this worktree, on top of round 1's candidate `f012d7bcc`. Diff:
`git show 6a5e095ad` (`git show --stat 6a5e095ad` lists the paths). Your round-1 answer is
`docs/plans/261021g-phone-sizes-part-two-code-review-2-sol.md`; the plan's § Code review records
what was kept and what was overruled.

This round is narrow. Discovery is closed; check only:
1. **Your C1–C6 fixes as committed**: that they are as you meant them, after my edits around them.
2. **The C3 overrule**: I removed `--dock-h` and `.dock-btn`/`.dock-home` from your new
   `any-pointer: coarse` block in `src/web/styles/narrow-window.css`, keeping the dock on
   `pointer: coarse` per `docs/project/touch.md` § How big a thing has to be (whose bullet I
   reworded). Is the dock still ≥40 under `pointer: coarse` at every root, and does the test in
   `tests/touch-targets-261021g.test.tsx` § the bottom dock really read the `pointer: coarse` block
   (not an `any-pointer` one)?
3. **C7**: the eleven `pointer-coarse:size-10` / `min-h-10` → `[40px]` swaps in seven components
   and the tests that pinned them, and the new TSX guard (its regex — false negatives such as
   `tw:any-pointer-coarse:[&_x]:size-10`, or false positives).
4. **`src/web/Metadata.tsx`'s second Archive button** (`ArchiveArticle`), floored like `QUIET_BUTTON`.

You may edit inside that scope only, narrowly and red-first. Run
`npx vitest run tests/touch-targets-261021g.test.tsx tests/touch-controls.test.ts tests/tweets-copy-icons.test.tsx tests/feedback-button-tooltip.test.tsx tests/profile-plan-help.test.tsx`.

Findings D1, D2, … with severity P0–P3, file:line, and what you changed. End with one line:
`VERDICT: ship` / `ship with fixes applied` / `do not ship`.
