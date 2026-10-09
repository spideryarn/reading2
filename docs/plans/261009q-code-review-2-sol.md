Land with fixes.

1. **P2 — The display separator polluted tool-loop protocol state. Fixed.**  
   The inserted `\n\n` entered `roundText`, so later requests replayed bytes the provider never wrote and `roundChars` counted them as model output. The separator now affects only the streamed/stored flattened answer; raw round text remains verbatim. Added a three-round regression. Evidence: [src/converse.ts:3075](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/src/converse.ts:3075), [guide-offer-converse.test.ts:146](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/tests/guide-offer-converse.test.ts:146).

2. **P2 — The written-twice eval missed most duplicate alignments. Fixed.**  
   Sampling every fifth offset detected duplicates only when their starting positions aligned modulo five. A reproduction returned `false` under the old scan and `true` when every offset was checked. Evidence: [offers.ts:132](/var/tmp/spideryarn-worktrees/guide-saves-reason-about/evals/guide/offers.ts:132).

No further issue found with citations, block IDs, command-token line boundaries, Markdown, stopping/truncation, retries, or spoken history. The separator condition is correct: first non-empty content of a later round, with earlier non-whitespace text and no whitespace supplied at either boundary. The tool-result wording also looks safe: it permits stopping only when the existing reply is complete and explicitly requires continuation otherwise.

Verification:

- 94 matching unit files: 1,352 tests passed.
- Focused converse pass: 30 tests passed.
- Typecheck passed for all 3,596 source files via `node --import tsx`; the npm wrapper itself hit the sandbox’s blocked `tsx` IPC socket.
- `chat-empty-answer-log.test.ts` could not run its child process for the same IPC restriction.
- Sixteen matching database tests could not start because Postgres/Docker is unavailable.
- Scoped lint passed with only the existing `converse` complexity advisory.
- `git diff --check` passed.