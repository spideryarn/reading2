Implemented stage 1 only. The live `toc/10` request, parser, builder, prompt, and `PROMPT_VERSION` remain unchanged.

Files changed:

- [messages-structured-output.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/messages-structured-output.ts) — runtime schema validator, block-id enum assertion, Messages adapter.
- [start-ranges.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/start-ranges.ts) — shared starts-to-ranges kernel with explicit whole-document/scoped policies.
- [hierarchy-starts.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/structure-starts.ts) — starts-only DTO and converter.
- [hierarchy-cascade.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/structure-cascade.ts) — `normaliseExpansion` now uses the shared kernel.
- [structure-starts-replay.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/evals/paperwork/structure-starts-replay.ts) — read-only offline replay and gate.
- Three new test files covering the validator/adapter, converter/kernel, and replay.

Red-first evidence:

- `tests/messages-structured-output.test.ts`: initially failed because the module did not exist; later additions caught unknown-keyword acceptance and shared-ref union undercounting.
- `tests/hierarchy-starts.test.ts`: initially failed because the converter did not exist; later refusal-order tests caught a behavior difference in scoped one-child answers.
- `tests/structure-starts-replay.test.ts`: initially failed because the replay module did not exist; its empty-corpus test subsequently caught a false-success gate.

Final gates:

```text
Test Files  8 passed (8)
Tests  233 passed (233)
```

```text
✓ src/web/tsconfig.json  (425 files)
✓ tests/tsconfig.json  (2515 files)
✓ tools/fleet/web/tsconfig.json  (104 files)
✓ tsconfig.json  (808 files)
✓ all 2634 source files are covered by some project
```

```text
Checked 8 files in 2s. No fixes applied.
```

The literal `npm run typecheck` could not start because the sandbox denied `tsx`’s Unix socket with `listen EPERM`. The same checked-in typecheck script passed via `node --import tsx scripts/typecheck.ts`, as shown above.

The database-backed replay was not run because loopback/database access is unavailable, per the brief; all its pure parts were unit-tested. No requested Vitest test required Postgres. The two pre-existing untracked files were left untouched.