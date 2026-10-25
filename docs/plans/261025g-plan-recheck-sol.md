DO NOT RUN

1. **Fixed** — preflight omits `FOR UPDATE`; rehearse/apply retain all three locks. The observed old-revision refusal confirms preflight now reaches its assertions.

2. **Not fixed** — `busy` detects the browser only after it has claimed the job. Remote cancellation is observed at a later step boundary, and cancellation during the last step may still publish. The after-the-fact gate only diagnoses an already-published revision. [refresh.mts](/tmp/claude-1000/-home-greg-code-spideryarn2/73bc4ad6-b7a6-409c-8ab7-5e927679ddd5/scratchpad/refresh.mts:236)

3. **Fixed** — the positional ID swap, exact fresh/kept HTML comparisons, order checks, changed-count check and supplied corruption tests cover the requested transformation. [refresh.mts](/tmp/claude-1000/-home-greg-code-spideryarn2/73bc4ad6-b7a6-409c-8ab7-5e927679ddd5/scratchpad/refresh.mts:125)

4. **Fixed for the original finding** — the canonical unpriced predicate is used, unpriced calls refuse further work, and reserves are accurately described as admission guards rather than a hard ceiling.

5. **Not fixed** — 75 seconds covers an active tab’s ordinary interval, not a suspended/background tab or its later exit flush. Existing-row locks cannot prevent a later insert of a missing stale row. Close every old article tab before Refresh and keep it closed through the final move check. [move.mts](/tmp/claude-1000/-home-greg-code-spideryarn2/73bc4ad6-b7a6-409c-8ab7-5e927679ddd5/scratchpad/move.mts:161)

6. **Fixed** — timestamped names plus `wx` prevent reruns overwriting an earlier seconds bundle.

7. **Fixed** — the dry run compares the full database SHA-256 and passes `raw_filename`; the omitted title tidier changes metadata only, not rendered blocks. [dryrun.mts](/tmp/claude-1000/-home-greg-code-spideryarn2/73bc4ad6-b7a6-409c-8ab7-5e927679ddd5/scratchpad/dryrun.mts:52)

New findings:

- **Major — spend can still be silently understated.** `parts` installs no `onStepSpend`; failed `ai_calls` inserts are swallowed and absent from `spend()`, exactly the gap documented in [jobs.ts](/var/tmp/spideryarn-worktrees/fbhrx8z2-refresh-order-of-time/src/jobs.ts:2508). **Change:** accumulate `SpendReport` through `onStepSpend`, refuse pending/unpriced calls, and reconcile observed call count against ledger rows before every next step and at exit.

- **Major — undo-file destinations cannot satisfy the plan.** Both the sensitive seconds bundle and IDs ledger use the same `OUT`, although the plan requires scratchpad-only seconds and a repository-side undo record. The directory entry is also not fsynced before the database commit. [move.mts](/tmp/claude-1000/-home-greg-code-spideryarn2/73bc4ad6-b7a6-409c-8ab7-5e927679ddd5/scratchpad/move.mts:136) **Change:** use separate private/ledger destinations, fsync the private directory before committing, and create the unique IDs-only record beside the plan after confirmed commit.

- **Minor — the gate self-test always exits successfully.** Unexpected passes/failures print `FAIL` but still reach `process.exit(0)`. **Change:** accumulate failures and exit nonzero if any verdict differs.