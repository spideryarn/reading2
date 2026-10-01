Review complete. I fixed all in-stage findings; no commit or paid model call was made.

Findings

- P0: none.
- P1 fixed — the report mixed eval calls with reader presses, deduplicated presses by `job_id` instead of collector `run_id`, and missed unpriced BYOK calls. It now reports only product Simple-step calls and labels its denominator honestly as checker-active presses. [simple-check-report.ts](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/scripts/simple-check-report.ts:104)
- P1 fixed — P1-1 was behaviorally implemented, but its requested audit detail was missing. Kept-first records now distinguish writer `call` failures from `validation` failures using `retryFailure`. [simple-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/simple-summary.ts:721)
- P2 fixed — refused guard-triggered retries were omitted from writer call/token accounting. They now count the request and preserve reported usage. [simple-summary.ts](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/simple-summary.ts:642)
- P2 fixed — the type and validator admitted impossible histories, including first-attempt stored flags and non-flagged results retaining attempt one after a flag retry. [types.ts](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/types.ts:4766)
- P2 fixed — the supposedly strict verdict parser accepted entries without paragraph numbers. [simple-check.ts](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/simple-check.ts:91)
- P2 fixed — the transport test asserted the model against `modelFor(...)`, so a quick-tier model change could pass. It now pins the measured Luna model literally. [simple-check.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/tests/simple-check.test.ts:90)

I also added exact call-bound assertions, report-SQL invariants, updated the plan’s record contract, corrected stale quick-tier comments, and split `writeLevel` helpers until lint no longer reports excessive complexity.

P1-2 decision

Declining the events table is reasonable for this beta trial now that the report clearly separates:

- surviving artifact verdicts;
- all product checker calls, failures, latency, and cost.

It remains unsuitable for unbiased historical verdict rates: failed or replaced presses lose their semantic verdicts. Add the append-only table if those rates become a release or model-selection criterion.

Gates

- Requested Vitest command: exit 0 — 8 files, 217 tests passed.
- `npm run typecheck`: exit 1 before TypeScript ran; the sandbox denied `tsx` permission to create `/tmp/tsx-1000/*.pipe`.
- Equivalent checker, `node --import tsx scripts/typecheck.ts`: exit 0 — all four projects passed; all 2,528 files covered.
- Biome on touched code: exit 0.
- `git diff --check`: exit 0.
- Extra `npm test`: exit 1 because the sandbox could not connect to the local Postgres/Docker service.

Verdict: code-ready; no open P0/P1/P2 finding. The only caveat is the exact `npm run typecheck` wrapper’s sandbox-level IPC failure.