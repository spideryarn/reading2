No production correctness bugs found. Count order, excluded matter/echo blocks, overlap handling, interaction states, style hoisting, and `TableView` memo dependencies are correct.

Findings, ranked by severity:

- Low — `quote-fill.test.ts` accepted malformed, half-formed `calc()` syntax. Tightened the parser to accept only a complete literal percentage or complete `calc(...)` expression: [quote-fill.test.ts](/var/tmp/spideryarn-worktrees/fbhtsjmf-glossary-underline-fade/tests/quote-fill.test.ts:205).
- Low — tests did not prove term+hit styles coexist, chats suppress fading, or hover/pressed/tap restore exact full-strength colours. Added those assertions: [annotate.test.ts](/var/tmp/spideryarn-worktrees/fbhtsjmf-glossary-underline-fade/tests/annotate.test.ts:549).

No production files were changed by this review, no wider issues were left unresolved, and nothing was committed.

Checks:

- Focused Vitest: 125 passed, 9 skipped.
- Typecheck: all five projects passed; all 3,984 source files covered.
- Biome lint on changed tests: passed.
- `git diff --check`: passed.

The literal `npm run typecheck` launcher hit a sandbox IPC `EPERM`; invoking the same script as `node --import tsx scripts/typecheck.ts` completed successfully.