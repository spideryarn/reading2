Found and fixed three issues:

- **C1 — P1 — fixed:** The requested test run had three failures because Skim’s named-exception assertions still expected bare `0.82rem`/`0.78rem`, not the new phone-floor wrapper. Updated [type-roles.test.ts](/var/tmp/spideryarn-worktrees/fby4yhnp-iphone-minimum-sizes/tests/type-roles.test.ts:198) and clarified the nearby Skim comments.

- **C2 — P1 — fixed:** Chat’s later stepper rule overrode the shared 40px icon size with `2.5rem`, producing 38.4px on the measured iPhone root and 30px at a 12px root. It now uses `max(40px, 2.5rem)` in [chat-actions.css](/var/tmp/spideryarn-worktrees/fby4yhnp-iphone-minimum-sizes/src/web/styles/chat-actions.css:268), with cascade coverage in [tap-target.test.tsx](/var/tmp/spideryarn-worktrees/fby4yhnp-iphone-minimum-sizes/tests/tap-target.test.tsx:186).

- **C3 — P2 — fixed:** The minimum-text guard went green for functional values such as `calc(0.72rem)`, functional Tailwind arbitrary sizes, and incorrect uses such as `min(var(--text-min), …)`. The scanner now finds nested literals and accepts only the documented floor form in [minimum-text-size.test.ts](/var/tmp/spideryarn-worktrees/fby4yhnp-iphone-minimum-sizes/tests/minimum-text-size.test.ts:46).

No further findings. The footnote anchor has no competing `::after` or positioning rule; its one-to-three-character inline cannot wrap, so the halo’s containing block is stable. Chat header/input flex constraints and long source-link wrapping remain sound.

Validation:

- Requested four suites: **94/94 passed**
- Direct typecheck: all four projects passed; all 3,896 source files covered
- Touched-file lint and `git diff --check`: passed
- Client build and generated Tailwind CSS: passed
- Full `npm test`: blocked before collection because local Postgres is unavailable
- Normal `tsx` launchers are blocked by the sandbox’s IPC restriction

The fixes are present but uncommitted: this environment exposes the worktree’s Git metadata read-only, so commit/push failed without modifying the index.