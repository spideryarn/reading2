### Finding

- **M1 — P3 — established, fixed:** The plan’s exhaustive eval list omitted `provenance.mts`, despite its new loader call. Corrected in [260924b-pdf-transcriber-writes-maths-as-tex.md](/home/greg/code/spideryarn2/.claude/worktrees/feedback-suggestions-0924/docs/plans/260924b-pdf-transcriber-writes-maths-as-tex.md:365).

No unresolved P0–P3 findings.

Checks:

- Complete caller sweep found no maths-bearing caller missing initialization.
- Both stage-wiring tests depend exclusively on their stage’s loader; nothing else in their module graphs loads Temml.
- Top-level `await` is safe for current importers: related importer tests passed, 4 files / 130 tests.
- Required Vitest gate: 8 files / 185 tests, exit 0.
- Env tests pass; no executable `require`/`createRequire` remains in the maths path.
- Exact `npm run typecheck`: exit 1 because the sandbox denied `tsx` its IPC socket before typechecking.
- Equivalent `node --import tsx scripts/typecheck.ts`: all 2,221 source files covered and all projects passed, exit 0.
- `git diff --check`: exit 0.

**Verdict: PASS — the fallback removal is correct; no unresolved findings.**