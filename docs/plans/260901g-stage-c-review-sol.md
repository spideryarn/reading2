Verdict: the core migrations are sound, and throwing on `provider-failed` is right in both callers. I would not commit this exact diff until one test-environment leak is fixed and the behavior-preservation claim is corrected.

## Findings

1. **`LOG_LEVEL` leaks into later test files.**  
   [tests/quiz-mark-stream.test.tsx:52](/home/greg/code/spideryarn2/tests/quiz-mark-stream.test.tsx:52) unconditionally sets `process.env.LOG_LEVEL = "info"` and never restores it. Vitest reuses workers and does not reset `process.env`; other log-capture tests preserve and restore the previous value for exactly this reason. This can make later suites noisy or order-dependent and also overrides an explicitly requested `debug` level.

2. **Clean reader cancellation now logs differently, contrary to the “one deliberate behavior change” claim.**  
   The new common `abandoned` branches in [explain.ts:642](/home/greg/code/spideryarn2/src/explain.ts:642) and [search.ts:741](/home/greg/code/spideryarn2/src/search.ts:741) emit the generic abandonment line for both thrown and clean cancellation. Previously:

   - thrown cancellation logged in the catch;
   - clean cancellation merely set `stopped` after the loop and did not emit that line.

   Search can now emit the new generic line followed by its specific duplicate-key, empty-text, or parse-failure abandonment line at [search.ts:825](/home/greg/code/spideryarn2/src/search.ts:825), [search.ts:850](/home/greg/code/spideryarn2/src/search.ts:850), or [search.ts:869](/home/greg/code/spideryarn2/src/search.ts:869). No test observes this. Throws and yields remain unchanged.

3. **There is a narrow ordering inconsistency around `provider-failed`.**  
   [classifyEnd():182](/home/greg/code/spideryarn2/src/ai-call.ts:182) gives reader abandonment precedence over `finish_reason: "error"`. Therefore, if the error finish-reason frame has already arrived but the reader aborts before `[DONE]`, both callers classify the result as abandoned rather than provider-failed. Explain may keep the partial answer; search may accept it if it parses.

   That differs from `chunk.error`, which is thrown immediately and is not mistaken for reader cancellation. It is latent today because the production explain/search routes do not pass their `gone` signals into these generators, but it means “both wire forms behave identically” is not completely true. Deadline → stall → reader otherwise preserves the old precedence exactly.

4. **The supplied diff is not self-contained for heartbeat.**  
   `round.diff` contains only the new heartbeat tests. The production guard is already in committed HEAD at [routes.ts:766](/home/greg/code/spideryarn2/src/routes.ts:766), having ridden along in `3183ddc`. The tree is correct, but the review bundle itself does not contain all “four fixes.”

## Answers

1. “No existing test rewritten” is literally false: the existing explanation test at [explain.test.ts:155](/home/greg/code/spideryarn2/tests/explain.test.ts:155) was renamed and its commentary rewritten. Its fixture and assertion were unchanged, and no existing assertion changed anywhere in the supplied diff.

   “No existing assertion changed” is useful evidence, but not load-bearing proof. The clean-cancellation logging change above went unnoticed by every assertion.

2. Throwing on `provider-failed` is right in both files. For search, streamed hits are explicitly previews; the strict final result is authoritative. An explicit provider failure should not become a successful stored search merely because the JSON happened to close. This is consistent with the existing `chunk.error` behavior. `length` is different: it describes why generation stopped, and a fully closed object can still be a valid short result.

3. The shared finish-reason scrape preserves the old last-non-null behavior. Deriving `stopped` is equivalent on every path that reaches search’s later checks:

   - a reader-abort throw is caught, then classifies as `abandoned`;
   - a clean reader abort also classifies as `abandoned`;
   - any other loop throw is rethrown before the switch and later checks.

   Nothing was silently dropped from thrown or yielded behavior. The unmentioned change is the additional clean-abort logging.

4. Deadline → stall preserves the old `explainAbort` precedence. Both before reader preserves the old policy too. Reader before ordinary provider finish reasons is sensible for behavior preservation. Reader before an already-observed `"error"` has the narrow inconsistency described above.

5. The heartbeat timer-counting tests are legitimate. Here the observable claim really is “no interval exists,” so timer count is the effect, not a shortcut for proving bytes were sent. The live-response control and the existing real-socket tests cover the other direction. The comment claiming a real socket cannot produce an already-closed response is overstated—a delayed server callback could—but the mock remains appropriate.

   The grade-word tests catch deletion of the production field and have a useful zero control. Minor overclaims:

   - joined substring assertions do not strictly prove `gradeWords` and “marked a quiz answer” occur on the same JSON line;
   - the search provider-error test does not assert that a hit was emitted before rejection;
   - the explanation truncation test proves successful generator output, not actual comment storage.

I could run `git diff --check` successfully. Independent Vitest/typecheck runs were blocked by this review sandbox’s read-only filesystem and IPC restrictions, so I relied on the supplied green-run evidence.

After restoring `LOG_LEVEL` and either preserving or explicitly naming the clean-cancellation log change, this is safe to commit.