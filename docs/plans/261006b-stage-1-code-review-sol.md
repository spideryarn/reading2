Reviewed `e5a9c07a7` exactly.

- **F9 — P1 — fixed:** [src/ai-call.ts:2370](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/ai-call.ts:2370). An observed in-band error lost its classification when a later body read threw: socket failure replaced it with `network`, while abort erased its failure fields. Two tests failed first. Finalisation now preserves `mid_answer / in_band / 200`, without changing the caller’s thrown error or retry decision.

- **F10 — P1 — not fixed; wider scope:** [evals/dig-deeper/budget.ts:233](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/evals/dig-deeper/budget.ts:233). Newly reclassified, unpriced malformed-200 responses match the budget’s “unbilled refusal” heuristic. An end-to-end probe settled one at **$0**, released its reservation and continued; the previous `ok` record halted the budget. This can undercount spend and undermine the cap. The consumer needs to distinguish confirmed refusals from accepted responses with unknown cost.

The nullable migration, realtime mappings and literal classification boundary look sound. I found no legitimate current answer falsely matching the error-envelope predicate.

Validation: **465 tests passed across 10 offline files**; six mutation checks failed as expected; lint passed. Source typechecks passed, but the test project has 36 errors in concurrent stage-2 work. Database tests were not run.

**Verdict: change first — F10 remains an unresolved P1.**

Files changed:

- [src/ai-call.ts](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/src/ai-call.ts)
- [tests/ai-call-transport-retry.test.ts](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/tests/ai-call-transport-retry.test.ts)
- [F9 postmortem](/var/tmp/spideryarn-worktrees/count-ai-call-deaths-and-retries/docs/postmortems/261006b-observed-in-band-failure-lost-after-later-stream-throw.md)