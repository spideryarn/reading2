# Review the proposed Overseer/fleet improvement roadmap

Read-only review. Do not change any file, send any message to live sessions, launch work, restart services,
or perform any real action. Return your verdict in the answer file through the wrapper.

Candidate: live pre-commit plan-only change based on 4adcdfd62703b6565a27a03c50f20f8a215f1bd8.
Exact new/untracked paths:
- docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md
- docs/plans/260908f-overseer-and-fleet-improvement-roadmap-baseline.txt
- docs/plans/260908f-overseer-and-fleet-improvement-roadmap-review-prompt.md (this brief)
No code changes are proposed in this turn. Read the files directly: git diff won't include them.
The final plan commit will be recorded in the handoff/review record after commit.

User requested a rich many-step plan to improve orchestrator and web code/functionality, prioritizing
value and ease, detailed enough for a less-capable agent to implement correctly. Review the WHOLE plan,
its dependency ordering, feasibility, missing high-value work, excessive complexity, contradictory
instructions and unsupported factual claims. This is a roadmap review, not a hunt for every code bug.
Cross-check important implementation instructions against current code, not only historical docs.

Start with docs/project/orchestrator-direction.md (ownership, order, autonomy and backlog), then the
candidate and evidence. Explore any related code/tests needed. Existing foundations must not be
reimplemented. Especially check recovery preservation across register deletion, action preview/
commit/outcome contracts, bounded collection, one store writer, admission, and schedule crash windows.
Consider whether an average agent could follow it without accidentally inferring approval to steer,
kill, change credentials, deploy production or replay uncertain side effects.

Run one self-contained relevant test file if useful, e.g.
node node_modules/vitest/vitest.mjs run tests/fleet-live.test.ts --maxWorkers=1
No network or Postgres is available in your sandbox. The parent ran four suites and the raw output is
in the baseline artifact. Existing UI freshness failures are recorded, not fixed by this plan.

Use IDs R1, R2, etc. Severity: P0 = dangerous/invalid whole approach; P1 = likely wrong implementation
or missing critical dependency; P2 = meaningful improvement/clarity; P3 = optional polish. For every
finding cite plan section and supporting code, give a concrete correction and why it matters. Separate
observed code facts from hypotheses. Finish with APPROVE / APPROVE WITH CHANGES / REVISE, and say
which findings must be resolved before this plan is handed to another agent. Do not treat whitespace,
length alone, or deliberately deferred feature work as blockers.

Author notes, last: early Sol advice moved minimal single-flight/backpressure/error-body containment
before the attention UI while keeping full performance work later. Attention -> resources -> usage ->
scheduler remains Greg's feature ordering. No browser validation was done in this plan-only task;
all UI findings are source-derived. Live checkpoint schema 1 versus source schema 2 is a provenance
mismatch, not a proved daemon outage.
