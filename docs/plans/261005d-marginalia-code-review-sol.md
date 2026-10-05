No P0/P1 findings. The implementation is correct after the review fixes.

Findings:

- **P2 — Fixed:** Current docs still said Marginalia was switch-gated and required the switch for the 900px first-open default. Corrected [reading-view-overview.md:171](/home/greg/code/spideryarn2/.claude/worktrees/fbvv54j2-marginalia-not-experimental/docs/project/reading-view-overview.md:171) and [url-state.md:723](/home/greg/code/spideryarn2/.claude/worktrees/fbvv54j2-marginalia-not-experimental/docs/project/url-state.md:723).
- **P3 — Fixed:** Several live source comments still implied relation words were first made only by a press. Corrected the import-versus-fallback distinction, beginning at [useRelations.ts:6](/home/greg/code/spideryarn2/.claude/worktrees/fbvv54j2-marginalia-not-experimental/src/web/useRelations.ts:6), plus the related activation, reset, rerun, Dock and Marginalia-feed comments.
- **P3 — Fixed:** The switch-on separator test passed for the wrong reason by treating Marginalia’s standalone frame edge as an internal group separator. The intended assertion was observed failing, then corrected at [dock-mode-order.test.ts:54](/home/greg/code/spideryarn2/.claude/worktrees/fbvv54j2-marginalia-not-experimental/tests/dock-mode-order.test.ts:54).
- **P3 — Fixed:** Removed stale mode counts, a dead Marginalia exclusion, misleading test commentary, and committed trailing whitespace.
- **P3 — Not fixed, wider existing issue:** Lint still reports Dock’s pre-existing excessive-complexity advisory and an unrelated type-only import advisory.

The three plan conclusions hold:

- Import queueing remains owner-scoped, opt-out-aware, unforced, and shares the press work key.
- Both visitor toggle presses arm nothing, mount no owner feed, make no private request, and send no non-GET request.
- First-open Summary + Marginalia mounts only press-gated hooks. Its dependency list correctly excludes the experimental value, and StrictMode applies it once.

Verification:

- 368 tests passed; 2 skipped.
- Direct typecheck passed all four projects and covered all 3,103 source files.
- `public-network-trace`: 78 passed.
- `publication-queues-the-main-modes` could not run because local Postgres was unavailable in the sandbox.
- Scoped lint exited successfully with only the two existing Dock advisories.
- `git diff --check` passed.

Files changed:

- `docs/plans/261005d-marginalia-plan-review-sol.md`
- `docs/project/reading-view-overview.md`
- `docs/project/url-state.md`
- `src/rerun-steps.ts`
- `src/reset-role.ts`
- `src/web/Dock.tsx`
- `src/web/activation.ts`
- `src/web/auto-run-targets.ts`
- `src/web/marginalia/MarginaliaColumn.tsx`
- `src/web/useRelations.ts`
- `tests/dock-corner-controls.test.tsx`
- `tests/dock-experimental-modes.test.tsx`
- `tests/dock-fit.test.ts`
- `tests/dock-mode-order.test.ts`
- `tests/public-network-trace.test.tsx`

VERDICT: approve