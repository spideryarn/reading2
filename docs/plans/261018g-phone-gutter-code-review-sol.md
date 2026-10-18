## P0

None.

## P1

- [narrow-window.css:145](/var/tmp/spideryarn-worktrees/fbk49y3q-phone-gutter-icons/src/web/styles/narrow-window.css:145): at 9px/12px roots, the 15px mark plus 4px inset exceeded the `1.25rem` pad and overlapped prose. Fixed with `max(1.25rem, 19px)`.
- [gutter.css:1143](/var/tmp/spideryarn-worktrees/fbk49y3q-phone-gutter-icons/src/web/styles/gutter.css:1143): the reading-time strip’s phone tap target was only the 20px pad, violating the existing 24px target floor. Fixed to use `--blk-slot`.

## P2

- [gutter-phone-bar.test.ts:43](/var/tmp/spideryarn-worktrees/fbk49y3q-phone-gutter-icons/tests/gutter-phone-bar.test.ts:43): added root-size and reading-strip regressions. Count assertions now independently cover both count classes, so deleting either declaration fails.
- [gutter.css:1128](/var/tmp/spideryarn-worktrees/fbk49y3q-phone-gutter-icons/src/web/styles/gutter.css:1128): corrected the documented heading/footnote specificity.
- [touch.md:520](/var/tmp/spideryarn-worktrees/fbk49y3q-phone-gutter-icons/docs/project/touch.md:520): clarified that narrow iPad split view uses the bar; only full-width iPad retains the column.

The heading/footnote positioning, container-query cascade, `[data-open]`, focus/failure states, one-slot sharing, and `BlockGutter` focus logic are sound. The 0.705 contrast test remains valid because the bar paints `--page`.

Checks:

- Required four-file Vitest run: 98 passed.
- Typecheck: passed all four projects via `node --import tsx scripts/typecheck.ts`. The requested npm wrapper itself was blocked before execution by sandbox-denied `tsx` IPC.
- Scoped lint: only existing warnings outside the new rules.
- Full `npm test`: blocked because local Postgres/Docker was unavailable.

VERDICT: ship after fixes (done)