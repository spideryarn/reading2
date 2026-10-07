**C1 — P1: successful completion can end with a permanent spinner.**  
Input: attempt A commits its terminal answer; another tab claims attempt B before the store’s subsequent list read. The new route sends `done` containing B’s `pending` row, then closes.

Reproduced through the real route with mocked store/model leaves: **2 genuine failures**, covering success and error endings. Fixed narrowly: a pending returned row contributes current reader fields while A supplies its committed terminal answer. A newer completed answer remains unchanged. Five route tests pass; **2 Postgres twins added, unrun**.

**C2 — P2: the original regressions admit plausible wrong implementations.**  
The server cases contain one comment, so `kept[0]` passes. The client suite never calls `place`, so whole-row replacement there escapes detection.

Strengthened both oracles. Deliberate mutations produced **1 sibling-row failure** and **2 placement failures**; both mutations were removed. Added passing probes for overlapping stream marks, X/Y isolation, placement removal, failed PATCHes, stream errors, deletion, StrictMode, and a stream entirely inside a PATCH’s lifetime.

Remaining limits: the Postgres chat tests could pass with transactional checks moved outside the lock; SV1’s cases do not independently protect the transactional tail guard; load counts do not prove lock placement.

**C3 — P3: rewritten comments still make false claims.**  
Reasoned and corrected:

- A second DELETE can perform the deletion when the first fails.
- Glossary Lookup searches first; Ask does different work.
- Route/store refusals need not have identical punctuation.
- Some checks already follow a store read.
- Retry-clearing wording overstated what the captured answer fields achieve.

No reader-facing wording changed.

A/B review found **no ordinary single-tab newly refused request**. Traced dialog, command bar, conversation handoffs, Learn/Quiz, Live, retry, recovery, and first-message edits. No-tail edit ordering is unchanged; stop/save preserves the tail id. Later SVO9 checks use an earlier snapshot, but all four rerun transactionally. History shows the old helper tests protected anchor immutability; the original gateway plan explicitly required API refusal.

The comment mark survived the probes. Same-tab deletion suppresses the fallback frame, so it does not resurrect the row.

**Files changed:** [routes.ts](/var/tmp/spideryarn-worktrees/sweep7-chat-comment-invariants/src/routes.ts), [chat.ts](/var/tmp/spideryarn-worktrees/sweep7-chat-comment-invariants/src/chat.ts), [types.ts](/var/tmp/spideryarn-worktrees/sweep7-chat-comment-invariants/src/types.ts), [useComments.ts](/var/tmp/spideryarn-worktrees/sweep7-chat-comment-invariants/src/web/useComments.ts); three comment test files; the stage plan, comments documentation, and [postmortem](/var/tmp/spideryarn-worktrees/sweep7-chat-comment-invariants/docs/postmortems/261007b-a-post-write-read-can-belong-to-a-new-attempt.md). **No commit.**

**What ran, raw counts:**

- Final selected Vitest run: **13 files, 151 passed, 0 failed**.
- Genuine red-first run: **25 passed, 2 failed**; subsequent focused run: **27 passed**.
- Mutation runs: **1 failed / 4 skipped**, and **2 failed / 20 skipped**.
- Typecheck: **4 projects passed; 3,340 source files covered**.
- Lint: **7 files; 19 informational diagnostics, 0 warnings/errors**.
- Diff whitespace check passed. No `npm test`. Postgres assertions remain unrun; an initial lane-startup block was not a test failure.

**Verdict: ship with these fixes applied**, subject to the orchestrator running the Postgres checks.

**Wider notes, unfixed:** a refused completion can still frame a newer pending attempt without adopting its stream. Separately, `carried` restores old error/citations/searches/model fields on later deltas; this exists at the base. The seven answer-owned fields are complete today, but their repeated manual lists do not enforce completeness when another field is added.