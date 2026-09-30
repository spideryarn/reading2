## Findings

- **C1 — P1 — Fixed:** AddPage could carry article A’s purpose draft into article B, while a late save for A could still queue modes and navigate after the address changed. Fixed by source-scoping completions and ignoring superseded save callbacks in [AddPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb60-reading-intent/src/web/AddPage.tsx:355). Proven by `does not carry the old article's purpose into the new add` and `ignores the old save when it answers after the new add has begun` in [add-page-purpose.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb60-reading-intent/tests/add-page-purpose.test.tsx:389).

- **C2 — P2 — Fixed:** A rapid double press in Trajectory could issue two purpose PATCHes and call `ensure()` twice before React disabled the button. Added a synchronous once-guard in [TrajectoryPurpose.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb60-reading-intent/src/web/TrajectoryPurpose.tsx:43). Proven by `submits only once when the plan button is pressed twice before re-render` in [trajectory-purpose-line.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb60-reading-intent/tests/trajectory-purpose-line.test.tsx:250).

- **C3 — P1 — Fixed:** Trajectory’s locally saved purpose survived a slug change, displaying article A’s purpose on article B. The purpose component is now keyed by slug in [TrajectoryPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb60-reading-intent/src/web/TrajectoryPanel.tsx:594), with stale async work fenced on unmount. Proven by `does not show one article's saved purpose on the next article` in [trajectory-purpose-line.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb60-reading-intent/tests/trajectory-purpose-line.test.tsx:271).

No visitor exposure was found: the purpose component remains owner-only. The server trace confirms awaited save → fresh profile resolution → Trajectory `profileHash` mismatch → unforced re-plan.

## Files changed

- [src/web/AddPage.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb60-reading-intent/src/web/AddPage.tsx)
- [src/web/TrajectoryPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb60-reading-intent/src/web/TrajectoryPanel.tsx)
- [src/web/TrajectoryPurpose.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb60-reading-intent/src/web/TrajectoryPurpose.tsx)
- [tests/add-page-purpose.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb60-reading-intent/tests/add-page-purpose.test.tsx)
- [tests/trajectory-purpose-line.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fb60-reading-intent/tests/trajectory-purpose-line.test.tsx)

Checks: requested suites 46/46; Trajectory pipeline tests 56/56; direct typecheck passed all projects and 2,408 files; targeted lint had no errors. Full `npm test` could not start without local Postgres, and the broader unit run hit unrelated sandbox permission failures.

**Verdict: Approve after fixes — three completion/state races were fixed, with purpose ordering and owner-only visibility preserved.**