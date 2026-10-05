Found one P1 defect within the stage and fixed it. No commits made.

- **F7 — P1, fixed:** [ai-call.ts:1802](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/ai-call.ts:1802) and [ai-call.ts:1964](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/ai-call.ts:1964). Cancellation after backoff resolves—or from the stream’s second activity callback—could open another meter although an already-aborted fetch sends no request. This produces an extra completed spend row, not a pending row or an established additional charge. Added cancellation checks before retry meter creation and six regression cases before fixing. **None was observed red or green:** the test command could not acquire the shared lock.

- **F8 — P3, fixed:** [test-file comment:11](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/tests/ai-call-transport-retry.test.ts:11), [ai-call.ts:1728](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/ai-call.ts:1728), and plan lines 81/189. Corrected the unsupported claim that mutation checks had run, the implication that retry cannot purchase work twice, the reversed PDF-policy comparison, and the claimed 30-second upper bound despite jitter.

- **F9 — P1, reported outside this stage:** [messages-stream.ts:716](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/src/messages-stream.ts:716) has the same missing cancellation check after a resolved wait. It predates this candidate; the helper move preserves it. The JSON, image and streamed seams also retain their pre-existing ability to open a meter on an initially aborted signal. Left these broader paths unchanged.

Source inspection found no further stage defect in priced-refusal handling, abort/deadline classification, stream termination state, or opt-outs. The hand-edited tests retain their stated purpose, but remain unrun. Embeddings retains its 240-second overall budget within the configured 800-second platform limit.

Lint and `git diff --check` passed. **No Vitest tests ran.** No typecheck, build, full suite or mutations ran.

Changed four files: `src/ai-call.ts`, `tests/ai-call-transport-retry.test.ts`, the 261005j plan, and [the new postmortem](/home/greg/code/spideryarn2/.claude/worktrees/qi-wwhdcejd-other-wires-retry/docs/postmortems/261005i-cancellation-checked-before-an-await-does-not-authorize-the-next-attempt.md).

**Verdict: land after the listed fixes.** The fixes are applied here; runtime verification remains outstanding.