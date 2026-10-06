1. **G1 — P2, established: an early error can discard later billable usage.** At [delegations.ts:310](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/src/web/live/gpt-live/delegations.ts:310), an already-dead response returns before usage is examined. A Node probe reproduced `response.created` → nested `error` without usage → `response.failed` with usage: the last event emits nothing. The planned status field leaves this unchanged. Provider occurrence of this sequence is unverified.

   **Smallest correction:** track whether usage was reported separately from whether tools may continue. Allow the first usable terminal usage through for an already-dead response without reviving its tools. Add that sequence as a regression test.

2. **G2 — P2, established: conflicting status reports are possible, and the first successful insert wins.** [delegations.ts:302](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/src/web/live/gpt-live/delegations.ts:302) leaves a completed response waiting for unfinished tools; `ended()` accepts that state. A probe emitted completed usage followed by failed usage for the same response id. Both projections have the same ledger id, and [ai-calls-pg.ts:254](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/src/store/ai-calls-pg.ts:254) discards the second insert. Normal queue delivery is ordered; a failed first delivery can allow the later report to be the only one inserted.

   **Smallest correction:** specify and test the authority rule. Keeping the first authoritative terminal usage is reasonable; enforce reporting once independently of tool state, using the accounting marker from G1. Keep insert retries idempotent. I have not established that OpenAI emits contradictory terminal events.

3. **G3 — P3, established coverage gaps; additional cancellation wire shape suspected.** The exclusive claim at [plan:14](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/docs/plans/261006g-gpt-live-backend-report-carries-its-terminal-status.md:14) exceeds the local evidence:

   - Usage is optional to the reducer, and missing input/output totals make `backendReport` return null.
   - Hang-up closes the producer after its grace period at [useGptLive.ts:851](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/src/web/live/gpt-live/useGptLive.ts:851). An unfinished backend without terminal usage gets no row.
   - Top-level errors at [useGptLive.ts:747](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/src/web/live/gpt-live/useGptLive.ts:747) are logged and generally let the session continue; they create no backend failure row.
   - A hypothetical nested `response.cancelled` is ignored by the parser. Local evidence does not establish that this wire emits it.

   **Smallest correction:** describe the fix as preserving status on the **handled terminal events carrying reportable usage**. Explicitly retain the missing-report limitation. Do not invent a cancellation event or classify every top-level error as a failed backend.

4. **G4 — P3, established: tests catch F30, but leave new rules untested.** Before concurrent source edits, the delegation, meter and server suites failed specifically on missing or incorrect status: 3, 2 and 4 failures respectively. However, [gpt-live-delegations.test.ts:325](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/tests/gpt-live-delegations.test.ts:325) supplies no usage on its nested error, so that portion passes before the fix and cannot verify the newly promised `failed` usage. Cost equality and unchanged row-id assertions also pass before the fix; they are preservation checks.

   **Smallest correction:** add nested-error-with-usage coverage, the G1/G2 sequences, and an event whose type disagrees with `response.status` to test the chosen authority. Make passing `effect.status` at `useGptLive.ts:632` explicit in the plan. The session-flow suite ran after another process implemented the mapping and passed; I did not observe its red baseline.

5. **G5 — P3, established: the compatibility fallback is safe but still hides unknown failures in aggregates.** `ok / null` is a reasonable bounded compatibility choice. Schema checks allow it and allow `error / null phase` and `aborted / abort / null phase`. No inspected `provider_status` reader rejects these shapes. Probes confirmed identical pricing; failed and incomplete rows enter total failure counts, while null-phase rows stay outside failure causes and part-way measurements. But [cost-cube.ts:378](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/src/cost-cube.ts:378) counts statusless `ok` rows as successful regardless of the null status.

   **Smallest correction:** document that old-tab failure counts remain incomplete. Also correct [plan:65](/var/tmp/spideryarn-worktrees/qi-p78m9ch9-gpt-live-status/docs/plans/261006g-gpt-live-backend-report-carries-its-terminal-status.md:65): ledger rows are also read by the cost CLI, not exclusively `/admin/costs`. No migration or broader outcome vocabulary is needed.

The existing outcome map is the simplest suitable projection. I found no second browser path reporting backend tokens. I changed no files.

build with changes