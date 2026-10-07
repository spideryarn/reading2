The design is sound. I found two P2 issues in the plan’s implementation scope and test specification, and no P0/P1 issue.

This review is against the original `b8a8e1c3c` baseline. Another session began editing `routes.ts` and the lifetime tests during the review; those edits are outside this verdict.

1. **F1 — P2, established: Stage 2 excludes caller changes required to compile.**

   The plan excludes `routes.ts` changes beyond the two Referee handlers and comments, but two other annotations must change:

   - Search declares `patch: Partial<SearchRun>` and passes it to `finish`. That type cannot satisfy `SearchFinish`.
   - The comment answer’s `settle` accepts `AnswerPatch`, whose status is optional, and passes it to `patch`. It must accept `AnswerFinish`.

   There is also an unnamed test helper: [comment-sweep.test.ts:87](/home/greg/code/spideryarn2/.claude/worktrees/sweep5-c6b-referee-search-contracts/tests/comment-sweep.test.ts:87) declares `nowPending(): Promise<string | undefined>`. Its returned token feeds valid fenced writes, which will fail typechecking after the change.

   **Fix:** explicitly include those caller annotations and the helper’s return type in Stage 2. Narrow valid calls; reserve casts for intentional runtime-refusal tests.

2. **F2 — P2, reasoned: the compiler-test recipe needs separate witnesses for the different guarantees.**

   “One per signature” using missing attempts, pending finishes and a forbidden `criterion` field does not fully specify coverage:

   - Returned-token guarantees need assignments or fake return values demonstrating that `undefined` is forbidden. Omitting an argument cannot test a `begin` return type.
   - `ClaimsFinish` already forbids `pending`, and Claims already requires an attempt. Those probes cannot be red-first evidence for its new writable-field restriction. Use `createdAt` and `sourceHash`.
   - Forbidden-field and nonterminal-status probes need an otherwise valid payload and attempt, so they fail for the intended reason.

   **Fix:** spell out those cases, include valid counterparts, and keep deliberately invalid store calls inside functions that Vitest never invokes. Check each directive’s baseline diagnostic rather than only the aggregate typecheck exit code.

The individual changes otherwise look right:

- Required tokens match the four adapters’ actual behavior. I found no additional production caller in scripts or evals, or another implementation requiring optional tokens.
- `StoredExchange` correctly separates spoken appends from pending turns. The spoken route takes only `.thread`; the other `Turn` names are separate types/components. I found no dependency on spoken `.attempt === undefined`.
- Search and Criteria currently store `{ status: "done", hits/results, model }` or `{ status: "error", error }`. They do not retain streamed partial results or a model on failure. The proposed unions fit those callers. Comments and Chat retain partial text and appropriately keep broader patches.
- Narrowing Claims to its writable fields is correct. Keep `MissingAttempt` and the terminal-status refusals: casts and untyped calls remain possible.

The X5 tests can fail today and pass after the proposed repair for the stated reasons:

- **Tests 1–2:** a nested `handleApi` gets fresh owner and spend scopes. With the same authentication, it reaches the same sweep as a separate request. Assert the stored row’s status after the real `finish`.
- **Test 3:** release only the older run and confirm the newer generator remains blocked before aging and sweeping. The older run’s `load` and superseded frame do not modify the newer row.
- **Test 4:** moving SSE setup inside the outer `try` releases the marker on setup failure. It leaves the row pending for collection after the grace window. That is consistent with Search and the existing abandonment policy.

The Criteria holder map and setup-failure tests are modest consistency work worth keeping. The unions add useful constraints, although optional `model` still needs careful omission handling; removing four spreads should not be their justification.

No repository edits were made, and no planned red-first tests were executed.

**Verdict: ready with these fixes.**