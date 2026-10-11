VERDICT: approve with fixes

1. [docs/project/sources.md:100](/var/tmp/spideryarn-worktrees/fbeyaf3n-sources-left-of-referee/docs/project/sources.md:100) and [src/mode-catalog.ts:340](/var/tmp/spideryarn-worktrees/fbeyaf3n-sources-left-of-referee/src/mode-catalog.ts:340) contained stale claims that Referee came first. I corrected them while preserving the command-bar alias reasoning.

2. [src/web/Dock.tsx:683](/var/tmp/spideryarn-worktrees/fbeyaf3n-sources-left-of-referee/src/web/Dock.tsx:683) still named the old critical run. I updated it and restored the important rationale about Sources adding material from outside the article at [Dock.tsx:972](/var/tmp/spideryarn-worktrees/fbeyaf3n-sources-left-of-referee/src/web/Dock.tsx:972).

3. [tests/dock-mode-order.test.ts:82](/var/tmp/spideryarn-worktrees/fbeyaf3n-sources-left-of-referee/tests/dock-mode-order.test.ts:82), [tests/dock-mode-order.test.ts:173](/var/tmp/spideryarn-worktrees/fbeyaf3n-sources-left-of-referee/tests/dock-mode-order.test.ts:173), and [tests/dock-more.test.tsx:64](/var/tmp/spideryarn-worktrees/fbeyaf3n-sources-left-of-referee/tests/dock-more.test.tsx:64) independently assert Sources before Referee and the separator before Sources. Reverting the order would fail them.

Checks: 126 relevant tests passed; full typecheck passed; scoped lint had only Dock’s pre-existing complexity advisory. Full `npm test` could not start database-backed lanes because local Postgres/Docker was unavailable. `doc-links` found only the plan’s forward link to the not-yet-created code-review document. No commit made.