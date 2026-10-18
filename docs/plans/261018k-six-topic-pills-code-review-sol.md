1. **Medium — [ShelfTerms.tsx](/var/tmp/spideryarn-worktrees/fbjw-six-topic-pills/src/web/ShelfTerms.tsx:341), [PublicShelfTopics.tsx](/var/tmp/spideryarn-worktrees/fbjw-six-topic-pills/src/web/PublicShelfTopics.tsx:119):** narrowing an expanded row to six topics removed the **All** control while leaving `all=true`, causing surprise re-expansion when the filter was cleared. Fixed by retaining the control while expanded; added red-then-green regressions for both shelves and updated the plan/project docs.

2. **Low — [shelf-topics.test.tsx](/var/tmp/spideryarn-worktrees/fbjw-six-topic-pills/tests/shelf-topics.test.tsx:13):** test documentation still said “first twelve.” Changed to six.

3. **Low, wider/pre-existing — [shelf-terms.md](/var/tmp/spideryarn-worktrees/fbjw-six-topic-pills/docs/project/shelf-terms.md:366), [shelf-narrow.ts](/var/tmp/spideryarn-worktrees/fbjw-six-topic-pills/src/web/shelf-narrow.ts:251):** the absolute claim that a pressed pill never moves is not always true: deliberately hiding earlier zero-count pills can shift it left. This change introduces no new reordering, so I did not alter the wider behavior.

The placeholder structurally matches six loaded slots—spinner plus five 28px ghosts—and reserves the same controls. A real viewport measurement was blocked by the sandbox’s known Chrome `setsockopt EPERM`/`SIGTRAP` failure, so phone/iPad/desktop pixel deltas remain unverified.

Verification: all four requested files passed, **135 tests**; typecheck passed for all **3,815** source files via `node --import tsx scripts/typecheck.ts` after the exact npm command hit the sandbox’s `tsx` IPC restriction. Targeted Biome lint passed. The six-pill tests contain literal six-item assertions and would fail against reverted production code; the new expansion tests were observed failing before the fix.

VERDICT: approve