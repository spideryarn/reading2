1. **C1 — still open (P1).** The arithmetic itself is correct: `budgetFor` gives 67,800 tokens; at 95 tokens/s that is 713,684 ms, leaving 26,316 ms inside 740,000 ms. But the test assumes the call receives the whole claim window. The deadline starts at `claimedMs` ([jobs.ts](/var/tmp/spideryarn-worktrees/fbe5t77w-explain-names-glossary/src/jobs.ts:2992)), while Glossary’s admission estimate remains only 120 seconds ([jobs.ts](/var/tmp/spideryarn-worktrees/fbe5t77w-explain-names-glossary/src/jobs.ts:833)). After an earlier step, the queue can therefore start this 714-second call with little over 120 seconds remaining. The SDK also has a 600-second initial-fetch timeout, although it clears once response headers arrive and does not bound the stream. Thus the job signal is the only whole-stream clock, but the new test does not prove the allowed response can finish within the remaining job time.

2. **C2 — still open (P1), with a new P2 defect.** The regex behaves as follows:

   - `1984`: retained.
   - `1984 (1949)`: dropped.
   - `Apollo 11 (1969)`: dropped.

   The latter two are indistinguishable from citations syntactically and can be legitimate work/event aliases. Contrary to the comment, the code does not establish that a bare equivalent exists before deleting them ([glossary.ts](/var/tmp/spideryarn-worktrees/fbe5t77w-explain-names-glossary/src/glossary.ts:342)).

   It also does not close the citation regression: it removes only the year-bearing alias, not the entry. In `names-final-1`, `Stenhoff` and `Rakov and Uman` remain entry names and still match their citations, beside Brand and Singer—four residual citation/book-author entries, not the stated “one or two.” Therefore the accepted residual in [§ Results](/var/tmp/spideryarn-worktrees/fbe5t77w-explain-names-glossary/docs/plans/261022f-explain-this-and-a-glossary-that-scales-with-length.md:137) is understated.

3. **C4 — closed.** `longPiece` is computed from body-word length without subtracting existing entries ([glossary.ts](/var/tmp/spideryarn-worktrees/fbe5t77w-explain-names-glossary/src/glossary.ts:1821)), so a nearly full long piece retains the part-by-part instruction. The production caller and all direct test callers were updated; the required property prevents an omitted TypeScript caller.

4. **Other scoped behaviour — no additional defect established.**

Verification: `npx vitest run tests/glossary.test.ts` passed, 102/102. No files changed; no commit, push, or production access.

REJECT