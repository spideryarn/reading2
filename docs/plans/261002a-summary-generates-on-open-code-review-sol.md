No P0/P1 findings. I fixed three P2 coverage gaps and found one P2 documentation issue left for approval.

1. **P2 — The mode rule overstates “always”.** [mode.md:113](/home/greg/code/spideryarn2/.claude/worktrees/fb7t-7v-summary-generate-on-open/docs/project/mode.md:113) says the only exceptions are Search, Chat, Referee Criteria, and Remember Recall. It omits modes with nothing to generate—Plain, Structure, Marginalia—and Referee Mirror, which waits for a comment. I left this unchanged because `mode.md` is a rule document requiring explicit before/after approval. Proposed replacement:

   > Modes with nothing to generate (Plain, Structure and Marginalia) open without a run. So do surfaces that need the reader’s words first (Search, Chat, Referee’s Criteria and Mirror, Remember’s Recall).

2. **P2 — The visitor regression test used the secondary signal. Fixed.** Production Reader identifies visitors through `drawer.visitor`; public non-reading pages use the `visitor` prop. The implementation correctly combines both at [Dock.tsx:1603](/home/greg/code/spideryarn2/.claude/worktrees/fb7t-7v-summary-generate-on-open/src/web/Dock.tsx:1603) and gates both activation callbacks. I changed [command-bar.test.tsx:1252](/home/greg/code/spideryarn2/.claude/worktrees/fb7t-7v-summary-generate-on-open/tests/command-bar.test.tsx:1252) to exercise the production drawer path.

   The other visitor-reachable surfaces are safe: the command bar is absent, Summary controls receive `slug={null}`, Diagram removes its picker, and Referee/Remember show the visitor boundary. None leaves an activation token.

3. **P2 — No exact top-level Summary boundary-retirement test. Fixed.** Added [a-broken-mode-leaves-the-article-readable.test.tsx:1795](/home/greg/code/spideryarn2/.claude/worktrees/fb7t-7v-summary-generate-on-open/tests/a-broken-mode-leaves-the-article-readable.test.tsx:1795). It presses Summary, throws from the real plain-words band, and proves the `simple` token is retired without posting. Removing the special case is correct: `bandTarget()` now obtains `simple` from Summary’s fixed row.

4. **P2 — Stored Summary behavior was only indirectly covered. Fixed.** Added both bottom-bar and command-bar cases at [every-mode-draws-its-surface.test.tsx:1341](/home/greg/code/spideryarn2/.claude/worktrees/fb7t-7v-summary-generate-on-open/tests/every-mode-draws-its-surface.test.tsx:1341), proving an already stored Summary posts nothing and leaves no token. The existing total `GENERATES` test already covers the command-bar Summary marker.

5. **P2 — Activation comments omitted the new Summary door. Fixed.** Updated [activation.ts:6](/home/greg/code/spideryarn2/.claude/worktrees/fb7t-7v-summary-generate-on-open/src/web/activation.ts:6), [auto-run-targets.ts:73](/home/greg/code/spideryarn2/.claude/worktrees/fb7t-7v-summary-generate-on-open/src/web/auto-run-targets.ts:73), and corrected the adjacent Plain description in `auto-modes.ts`. No stale live source/test/project-doc claim remains; old plans and review diffs retain their historical wording intentionally.

The SimplePanel condition is correct: `useStepJob` exposes `job` only for queued/running work. Failed or cancelled jobs become `job: null` plus `failed`, and `JobProgress` displays the failure and appropriate Retry/Write-it action, so the owner line is not wrongly hidden after failure.

Validation:

- Focused tests: **7 files, 305 tests passed**
- Typecheck wrapper: **all four projects passed; all 2,644 source files covered**
- Scoped lint: no errors; one existing informational complexity warning at `every-mode-draws-its-surface.test.tsx:778`
- Full `npm test`: blocked before collection because the sandbox could not reach the local Postgres/Docker service
- No commit made; unrelated feedback-note/generated-index changes were left untouched.