**Verdict: ship with these fixes applied.** Fixes are in the worktree; nothing was committed.

- **C1 — P1 — PQO3, absent-parts refusal.** Input: a begun step returns no `parts`. **Reasoned:** deleted case 6 checked that refusal retained the begun run; its named twins checked refusal and interruption separately. They could pass an implementation that closes the run when refusing absent parts. **Fixed:** added that Postgres case (**unrun**), plus pure runtime and compile-time guards. The runtime guard mutation went red.

- **C2 — P2 — PQO6, timer identification.** Input: change the first backoff to 1 ms. **Reproduced:** correct code failed because the test found no 375–625 ms timer. Its count prevented vacuous success, but did not establish timer identity. **Fixed:** wrap the real `waitOrStop`; assert opened attempts, sends, completed rows and pending rows. Removing the cancellation check now fails with `expected 2 to be 1`, catching attempt 2 opened then aborted. **Run, green.**

- **C3 — P2 — PQ3, uncovered clauses.** Inputs: a cancelling carrier, live Structure failure, or Labels cancellation. **Reasoned:** existing fixtures could miss removal of `not(cancelling)` or broadening of the live trigger. **Fixed coverage:** three Postgres cases, **unrun**. The implementation correctly retains exclusion, owner scope, `unfinished === "labels"` and error-only marking.

- **C4 — P3 — inaccurate claims.** **Reasoned from code and earlier evidence.** Assets’ stamp has no model; Sketch and the null checkpoint store have more callers than stated; the helper includes running jobs; earlier transport gates already recorded the six cancellation tests red. The sweep previously used one batched query, and its new query count has no fixed small bound. **Fixed** these comments/docs and the plan’s twin table.

All ten claimed twins were inspected. The two-part overwrite rule survives in `pg-session-real-step`; the originally named arc test was weaker. Searches found no remaining executable uses of the deleted machinery, including string-built references. `finish` and `releaseStep` are unchanged. Summary’s stored-provenance exception matches the code; both existing owner quotes remain byte-for-byte unchanged, with no new owner attribution.

Changed files: four test files (`check-product`, `messages-stream`, `publication-enqueues-the-labels-successor`, `store-pg-session`); comments in `pg-jobs.ts`, `sketch.ts`, `checkpoints.ts`; the plan, `summaries.md`, transport postmortem, and a [new fixture postmortem](/var/tmp/spideryarn-worktrees/sweep7-pipeline-tidy/docs/postmortems/261007e-a-timer-duration-is-not-the-boundary-it-belongs-to.md).

Validation:

- Baseline: **352 passed**, three files.
- Final: **354 passed** — check-product **8**, Messages **86**, transport retry **260**.
- Controls: original timer fixture **1 failed/85 skipped**; retry-guard removal **1 failed/85 skipped**; absent-parts guard removal **1 failed/7 skipped**. Mutations restored.
- Typecheck: **4 projects passed**, **3,367 source files covered**. Used `node --import tsx scripts/typecheck.ts` because the normal launcher’s IPC listener was sandbox-blocked.
- Scoped lint: **7 files checked, 1 pre-existing error** at `pg-jobs.ts:1240`.
- Diff whitespace check passed. **No Postgres tests or `npm test` run.**

Wider notes: article locks serialize enqueue and ordinary session completion with settlement. Stop can cancel a queued successor during that transaction, leaving `pending`; the same outcome is deliberately permitted after settlement commits. Fixing that requires changing Stop. An older-base successor can also be counted despite being unable to finish the current revision; that existing wider gap remains unchanged.