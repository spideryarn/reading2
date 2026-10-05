Cancellation is wired correctly: `sse().gone` reaches Mirror’s composite signal, the upstream fetch, and the body reader. It covers pre-response and mid-body disconnects. After `[DONE]`, parsing may finish; frames are suppressed on the closed socket, and `runMirror` ends the response in `finally`.

All six continuing streams have save paths. Mirror stores no answer, and `useMirror` aborts its fetch on cleanup. The original test fails if signal forwarding is removed, but it cannot detect failure reporting being removed entirely.

The permitted test command failed during setup: local Postgres access returned `EPERM`, and Docker was unavailable. **No tests ran.** No commits were made.

VERDICT: not ready

- **F1 — independent failures can disappear from Sentry:** [routes.ts:5359](/home/greg/code/spideryarn2/.claude/worktrees/q-paid-streams-mirror-stops/src/routes.ts:5359). A provider rejection followed by disconnect before its catch runs is suppressed despite remaining an `error` in the ledger. Suppressing only Mirror’s `READER_LEFT` error is worth doing. Added regression cases at [referee-mirror-route.test.ts:460](/home/greg/code/spideryarn2/.claude/worktrees/q-paid-streams-mirror-stops/tests/referee-mirror-route.test.ts:460); left production code unfixed because the required red-first run was blocked. The equivalent `streamAskedTerm` issue remains outside scope.

- **F2 — accounting claim was too broad:** [plan:54](/home/greg/code/spideryarn2/.claude/worktrees/q-paid-streams-mirror-stops/docs/plans/261005i-mirror-stops-its-model-call-when-the-referee-leaves.md:54). Aborted calls retain any price already received. Corrected the plan and test comment: null credits are correct for this stub, which sends no priced usage. Cancellation alone cannot establish OpenRouter’s final bill.

- **F3 — storage claim needed qualification:** [routes.ts:1295](/home/greg/code/spideryarn2/.claude/worktrees/q-paid-streams-mirror-stops/src/routes.ts:1295). Confirmed every save path; qualified the comment and plan for failed saves and deleted or superseded rows. Added the cancellation signpost at [referee-mode.md:499](/home/greg/code/spideryarn2/.claude/worktrees/q-paid-streams-mirror-stops/docs/project/referee-mode.md:499). `cost-tracking.md` contained no obsolete Mirror claim.

- **F4 — response completion was unchecked:** added a `writableEnded` assertion to the original disconnect test. `git diff --check` passed; the added tests remain unexecuted.