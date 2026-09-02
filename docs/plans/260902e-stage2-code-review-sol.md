# Verdict

**NO-SHIP.** A retained activation token demonstrably lets Back navigation start a paid job, directly violating the explicit “Back/Forward spends nothing” rule.

## Ranked findings

1. **Critical — demonstrated bug: Back can spend a retained activation token**

   The implementation deliberately retains a token after its panel unmounts ([activation.ts](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/activation.ts:58)). The existing test demonstrates the violating sequence:

   1. Click Ideas while its GET is held.
   2. Click Quotes, unmounting Ideas.
   3. Quotes starts.
   4. Arrive back at Ideas without clicking.
   5. Ideas starts from the retained token.

   The test explicitly expects the second POST ([modes-that-start-themselves.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/tests/modes-that-start-themselves.test.tsx:469)).

   The separate “Back or Forward spends nothing” test does not cover this case because it begins with no earlier click and therefore no retained token ([modes-that-start-themselves.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/tests/modes-that-start-themselves.test.tsx:444)).

   The claimed bounds do not solve authorization:

   - The one-attempt guard limits it to one charge.
   - The epoch limits it to one login session.
   - Tab lifetime may be hours or days.

   None ties consumption to the original navigation. The later Back step is still what causes the paid request. This is especially clear if the original off-screen GET has already returned 200 or failed: because its component is gone, nothing consumes the token despite [activation.ts](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/activation.ts:51) claiming every settled result retires it.

   If the original press must survive unmounting, its already-started GET and decision need to survive together and finish off-screen. A future mount must not inherit the permission.

2. **High — demonstrated bug: clicking an already-selected mode cannot recover from a failed GET**

   After a GET failure, `useAutoRun` consumes the token and exits because status is `"error"` ([useAutoRun.ts](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/useAutoRun.ts:85)). Clicking the already-selected Dock mode then:

   - mints a new token;
   - calls the same mode setter ([Dock.tsx](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/Dock.tsx:959));
   - does not remount the panel or rerun its load effect;
   - immediately consumes the new token against the still-current `"error"` status and exits again.

   Ideas, Quotes, and Timeline only reload through their mount/dependency effect—for example [useIdeas.ts](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/useIdeas.ts:165). Their error states offer no run button.

   This directly contradicts the stated purpose of the nonce: allowing a reader whose first press met a failed GET to press the already-open mode again ([activation.ts](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/activation.ts:34)).

   The tests miss it. The already-selected test starts from a settled `"none"` status, while the failed-GET test never presses Ideas again.

3. **Medium — demonstrated test gap: Timeline and Sketch have no positive activation test**

   The focused activation suite imports and renders only Ideas, Quotes, and Glossary ([modes-that-start-themselves.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/tests/modes-that-start-themselves.test.tsx:152)). The full-app positive control starts only Ideas.

   Consequently, all new tests could remain green if either of these were removed:

   - `useAutoRun` from `useTimeline` or `useSketch`;
   - Sketch’s `armActivation` call in `DiagramPanel`;
   - Timeline’s entry in `MODE_TARGET`.

   The current code is wired correctly, but those two paid paths are not held by a positive test.

   The StrictMode mutation evidence is also weaker than claimed: the comment says both atomic gates were deferred together ([modes-that-start-themselves.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/tests/modes-that-start-themselves.test.tsx:407)). That proves the combined defence, not atomic token consumption independently. The one-attempt guard does have separate coverage through the repeated-click and failed-attempt cases.

## Checks that landed correctly

- Tokens are minted only in the real Dock and Sketch click handlers. Slug, target and consumption-time epoch checks are correct.

- Delete-before-return makes two panels and StrictMode unable to consume one token twice.

- `beginAutoAttempt` is genuinely synchronous: it checks and inserts at [jobEngine.ts](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/jobEngine.ts:706), and `useAutoRun` calls it before invoking the async run ([useAutoRun.ts](/home/greg/code/spideryarn2/.claude/worktrees/article-job-queue/src/web/useAutoRun.ts:92)). Teardown clears it. I found no generate-fail-generate hole.

- Empty-state requests are unforced for all five. Ideas, Quotes, Timeline and Sketch split `ensure` from forced `regenerate`; their panels call the right verb. Glossary correctly differs: `find` is unforced, `more` is forced because forcing appends, and “Start again” deletes before making an unforced fresh run.

- First-poll reconciliation is sound. It tracks the exact returned ID, clears it before announcing, relies on the earlier `useJobs` drain to mark normal completions, and does not promote historical jobs. The focused test has the right unseeded-engine shape.

- The builder’s StrictMode account is correct: Ideas, Quotes, Timeline and Sketch mount as `"loading"` and reach `"none"` on an update; Glossary can mount with its shared read already settled, so only Glossary exercises double-invoked auto-run effects in this suite.

I attempted the five scoped Vitest files, but the read-only sandbox prevented Vite from creating `node_modules/.vite-temp`; no tests executed.