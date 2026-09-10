Implemented Stage 3’s refusal journal without committing or accessing `:8787`.

Verification:

- Required focused suites: 92/92 passed.
- Typecheck: all four projects passed; 1,914 files covered.
- Focused readiness admission test passed.
- Targeted lint: no errors; one pre-existing JSX-semicolon warning.
- `git diff --check`: passed.
- Full `npm test` was not run, as requested.

Journal-read measurement: with both files at 65,410 bytes, holding 620 entries, 100 reads took 2.03 ms median, 2.20 ms p95, and 3.20 ms maximum.

### Red-first evidence

| Behaviour | Initial failure |
|---|---|
| Concurrent processes | Missing module initially; first implementation then exposed `EBADF` until the append flags included writable append semantics |
| Oversized line | `recordRefusal` returned `true` instead of `false` |
| Failed append | `ENOTDIR` propagated instead of being swallowed |
| Pruning | `pruneRefusals is not a function` |
| Unparseable lines | Count was 1 instead of 2 because structurally invalid JSON was accepted |
| Absent/unreadable directory | An absent directory returned `{kind:"read", entries:[]}` |
| Empty journal copy | Journal block was absent instead of saying “nothing was recorded” |
| Vitest source guard | Call position was `-1`; commenting out the completed call reproduced the same red |
| Readiness discriminator | Memory skip lacked `cause: "memory-admission"` |
| Route arms | All three responses had `journal: undefined` |
| Panel arms | Directory-absent, unreadable, entries, and parse-count cases rendered an empty block |
| Corrected journal time | Raw `2026-09-10T04:05:06.000Z` rendered instead of the clock-corrected local time |

A wider `tests/readiness-loop.test.ts` run had 58 passing tests and three unrelated failures because this sandbox denied `spawnSync git` with `EPERM`. Its focused memory-admission test passed.

### Files changed

- [admission-journal.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/admission-journal.ts) — bounded atomic appends, two-file reads, parsing, and rename rotation.
- [vitest.config.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/vitest.config.ts) — records test-run refusals immediately before throwing.
- [readiness-loop.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/readiness-loop.ts) — optional memory-admission cause.
- [scripts/readiness-loop.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/scripts/readiness-loop.ts) — readiness refusal writer.
- [routes-admission.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/routes-admission.ts) — independent journal field and failure arm.
- [admission-wiring.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/admission-wiring.ts) — production journal reader.
- [wire.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/wire.ts) — journal wire types.
- [admission-client.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/admission-client.ts) — defensive journal parsing.
- [AdmissionSection.tsx](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tools/fleet/web/src/AdmissionSection.tsx) — journal panel, scope disclaimer, explicit absence arms, and corrected timestamps.
- [admission-journal.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/admission-journal.test.ts) — writer, concurrency, rotation, reading, and source-guard tests.
- [fleet-admission-explain.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/fleet-admission-explain.test.ts) — route dependency fixture.
- [fleet-admission-route.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/fleet-admission-route.test.ts) — journal route arms.
- [fleet-admission-panel.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/admission-visibility/tests/fleet-admission-panel.test.tsx) — journal rendering and wording tests.

Nothing in the authorised stage was left unimplemented.