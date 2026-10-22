C1 — P2 — [mode-band.css:1269](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/mode-band.css:1269): the base `padding` shorthand followed the equal-specificity coarse rule, silently resetting `padding-inline: 0.75rem` to `0.5rem`. Fixed by moving the coarse block after the base `.bring-in` rules at [mode-band.css:1311](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/src/web/styles/mode-band.css:1311).

C2 — P2 — [tap-target.test.tsx:230](/var/tmp/spideryarn-worktrees/fby4yhnp-phone-sizes-part-two/tests/tap-target.test.tsx:230): the candidate test did not pin row/title padding, exact divider styling, or `.bring-in` placement, and inspected only the media block rather than the effective equal-specificity cascade. Expanded the assertions and added a source-order guard. It failed red on C1 before the CSS fix, then passed.

No further findings. All `BringIntoChat` states retain the direct-child wrapper; sources without Bring remain valid; `.bring-in-pasted` is unaffected; unbroken titles retain `overflow-wrap: anywhere`; colour/hover rules have no later competitor.

Checks:

- Focused Vitest: 16/16 passed.
- Typecheck: all four projects passed.
- Lint: completed with four advisory `noDescendingSpecificity` warnings.
- Full `npm test`: unavailable because the local Postgres/Docker service cannot be reached in this environment.

VERDICT: ship with fixes applied