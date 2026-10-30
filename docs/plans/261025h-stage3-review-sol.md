Reviewed and fixed four findings. No P0/P1 findings and nothing wider needs a decision.

## Findings

- **S3-F1 — P2 — phase models were inferred, not captured from the wire.** Candidate evidence: `src/situate.ts:1531-1540, 1635, 1717, 1772`. A future task-specific pin could therefore run one model while stamping another, hiding a real model change from freshness. Fixed by exposing the exact resolved model on `MeteredCall` and storing it for every phase: [messages-stream.ts](/var/tmp/spideryarn-worktrees/agent-ae6b3c79c5cbff23b/src/messages-stream.ts:480), [situate.ts](/var/tmp/spideryarn-worktrees/agent-ae6b3c79c5cbff23b/src/situate.ts:1535). The regression test was red first and now proves independent plan/triage/read pins are preserved: [situate.test.ts](/var/tmp/spideryarn-worktrees/agent-ae6b3c79c5cbff23b/tests/situate.test.ts:1433).

- **S3-F2 — P2 — malformed or partial `phases` could throw or be accepted as current.** Candidate evidence: `src/store/artifacts.ts:520-523` accepts any dossier with a findings array, while `src/situate.ts:316-327` dereferenced unchecked phase fields and did not enforce outcome/phase coherence. Fixed fail-closed validation covering missing outcomes, null/partial phases, read-without-triage/writer, and impossible `nothing-found` stamps: [situate.ts](/var/tmp/spideryarn-worktrees/agent-ae6b3c79c5cbff23b/src/situate.ts:316). Six cases failed in the first red run; the missing-outcome case was also observed red separately. Tests: [situate.test.ts](/var/tmp/spideryarn-worktrees/agent-ae6b3c79c5cbff23b/tests/situate.test.ts:1513).

- **S3-F3 — P3 — the rate-bucket contract still described the pre-triage flow and cost.** Candidate evidence: `src/store/contracts.ts:3462-3465`. Fixed to name Haiku triage, shortlist reading, and the $0.30/$0.52 ladder: [contracts.ts](/var/tmp/spideryarn-worktrees/agent-ae6b3c79c5cbff23b/src/store/contracts.ts:3462). Prose-only; existing cost-category tests remained green.

- **S3-F4 — P3 — several descriptions called 12,000 tokens the whole triage budget.** The wire actually allows 3,000 answer tokens plus 12,000 thinking headroom: 15,000 total. Fixed in the plan, investigation, setup guide, and source comment. The executable assertion remains at [situate.test.ts](/var/tmp/spideryarn-worktrees/agent-ae6b3c79c5cbff23b/tests/situate.test.ts:1357).

## Attack conclusions

- Triage is Haiku at both powers; plan/read follow standard Sonnet versus high-power Opus. No environment override exists for these tasks.
- Triage is recorded as task `situate-triage`, classified `step-driven`, and charged to on-demand enrichment.
- Only gathered source IDs survive triage. Its prose reaches neither searches, the read, nor storage. Findings remain checked against all gathered evidence.
- Empty, malformed, or failed triage remains reader-visible failure. A failed paid attempt consumes its allowance correctly, releases concurrency, and the same job cannot buy the step twice.
- Pre-triage `situate/2` dossiers remaining current is sound: their prompt/checks are unchanged and their full capable-model read is not defective.
- The privacy-page decision is sound: Haiku receives the same article/evidence through the same OpenRouter/Anthropic route, without the profile; the existing section already states this explicitly.

## Checks

- Targeted unit/model/cost/privacy suites: **7 files, 263 tests passed**.
- Typecheck: **all 4,030 source files covered; passed**.
- Lint and `git diff --check`: passed.
- Postgres suites could not initialize: sandbox connection to `127.0.0.1:54362` returned `EPERM`. The actual freshness filename is `tests/freshness-deciders-agree.test.ts`.
- No commit made. The two pre-existing untracked Stage 3 review files were left untouched.