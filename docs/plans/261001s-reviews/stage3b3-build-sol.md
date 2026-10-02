Implemented stage 3b part 3. No commits or state-changing Git commands were made.

### What changed

- Added the chat-wire adapter beside the existing Messages adapter in [messages-structured-output.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/messages-structured-output.ts:410). Keeping both adapters together gives them one validator and one schema contract.
- Skim now sends `SKIM_OUTPUT_SCHEMA`, preserves `effort`, and is stamped `skim/8`. Its prompt text is unchanged: [skim.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/skim.ts:114).
- Added strict schemas to:
  - [simple-check.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/simple-check.ts:123), with optional `n` and `why`, plus pre-parse finish/refusal checks.
  - [citation-paper-passages.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/citation-paper-passages.ts:112).
  - Debate synthesis only in [debate.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/debate.ts:1952) and [debate-themes.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/debate-themes.ts:94). Its now-unreachable fence was removed; passes A and B remain fenced and unchanged.
  - [referee-mirror.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/src/referee-mirror.ts:1072). Raw-delta keepalives and closed-object-on-`length` behavior remain intact.
- Updated [skim.md](/home/greg/code/spideryarn2/.claude/worktrees/structure-code-in-answer/docs/project/skim.md:122).
- Added or updated eight direct test files, plus the necessary stale fixtures in `debate-passes` and `simple-summary`.

### Red-first evidence

Initial command:

```text
npx vitest run tests/messages-structured-output.test.ts tests/skim.test.ts tests/simple-check.test.ts tests/citation-paper-passages.test.ts tests/debate-themes.test.ts tests/referee-mirror-stream-end.test.ts
```

Summary:

```text
Test Files  6 failed (6)
     Tests  11 failed | 170 passed (181)
```

Those failures covered: missing adapter behavior, missing Skim schema/version, absent Simple schema and finish/refusal rejection, missing Citation/Debate/Mirror schemas, and Debate’s fenced synthesis response.

### Gates

Required touched-test and doc-links gate:

```text
Test Files  9 passed (9)
     Tests  297 passed (297)
  Start at  02:33:05
  Duration  11.32s (transform 6.43s, setup 902ms, import 9.58s, tests 9.65s, environment 2ms)
```

Additional database-free adjacent regression sweep:

```text
Test Files  20 passed (20)
     Tests  531 passed (531)
  Start at  02:42:58
  Duration  14.84s (transform 8.88s, setup 1.55s, import 19.71s, tests 3.07s, environment 4ms)
```

Literal `npm run typecheck` hit the sandbox’s `tsx` IPC restriction:

```text
Error: listen EPERM ... /tmp/tsx-1000/14.pipe
Node.js v26.8.1
```

Documented fallback:

```text
✓ src/web/tsconfig.json  (429 files)
✓ tests/tsconfig.json  (2531 files)
✓ tools/fleet/web/tsconfig.json  (104 files)
✓ tsconfig.json  (809 files)
✓ all 2649 source files are covered by some project
```

Lint/diff:

```text
Checked 15 files in 3s. No fixes applied.
Found 6 infos.
```

The infos are existing template-literal and complexity advisories. `git diff --check` passed.

Full `npm test` could not initialize its private database lane:

```text
[private lane] could not scavenge (carrying on): connect EPERM 127.0.0.1:54362
No test files found, exiting with code 1
Error: No database, and every test that touches the store needs one.
Run: npm run db:start
```

I did not start or reset the shared Supabase service.

### Provider support

All existing provider routing remains unchanged:

- Simple Check: Luna, no provider-order pin, `require_parameters: true`.
- Citation passages, Debate synthesis, and Mirror: Anthropic order pin with `require_parameters: true`.
- Skim remains on the Messages wire with its existing Sonnet/Opus choice.

The repository explicitly records Luna as supporting structured outputs, and `pdf-read` already uses the same Luna model with strict `json_schema`. Anthropic Sonnet/Opus are likewise already used by strict chat-schema callers. All six existing schemas pass the shared validator:

```text
paper-metadata: compatible
pdf-authors: compatible
pdf-figure-locate: compatible
pdf-frontmatter: compatible
pdf-read: compatible
shelf-terms: compatible
```

Migrating those six would be mechanically small, but not literally a one-line diff each: wrap the request and remove the inline `response_format`; no schema changes are needed. No paid live provider probe was run.

### Cheapest validity checks for Claude

- Skim, one call:
  `npx tsx scripts/eval/skim-coverage-eval.ts --runs=1 --new-only --new-version=skim/8 <slug>`
- Simple Check: the current fidelity probe duplicates the old request rather than calling production `checkLevel`. The cheapest honest check is a one-level production harness: one Luna call.
- Citation passages: a direct `findPaperPassages` harness over one already-read paper is one Opus call. The existing `261001a-paper-read-probe.ts --paid --works 1 --slug <slug>` is broader and buys the whole press.
- Debate synthesis, one call:
  `npx tsx evals/debate/themes.ts <one-debate.json>`
- Mirror: `npx tsx evals/referee-mirror.ts` is the cheapest existing honest evaluation, but runs its eight cases; it has no single-case flag.

Unrelated concurrent worktree changes and pre-existing untracked files were left untouched.