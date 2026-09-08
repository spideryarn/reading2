# Fable review of the Overseer and fleet improvement roadmap

Greg explicitly requested: “Get a review from Fable, via docs/reusable/claude-cli-as-subagent.md,
then revise as you see fit, and push.” Review the complete current plan independently.

Read `AGENTS.md` first. This is a read-only review: do not edit files, run commands, inspect secrets,
contact services, or change live sessions. Do not delegate further. Return your review as the final
answer; the wrapper will save it.

Candidate: `docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md`, committed at
`b6fb68844bd6ffb044098bd19b6300f8caa1029f`. Other agents share this checkout; distinguish subsequent
changes from defects in this candidate.

The original request is a rich many-step plan to improve orchestrator and web code/functionality,
prioritised by ease and value, detailed enough for a less-capable agent to execute correctly.
This task is to improve that plan, not implement it.

Read the whole candidate, then the relevant sections of:
- `docs/project/orchestrator-direction.md` (Greg's priorities and constraints).
- `docs/plans/260908f-orchestrator-wave-2-write-path-usage-limits-box-health-history-attention-inbox-codex-adapter.md`
  (already commissioned work; this roadmap must integrate it, not silently defer it).
- The candidate's linked baseline and validation artifacts as needed.
- Source files relevant to any technical finding you make. Exact symbols are in the candidate's
  code map. Verify alleged defects rather than assuming the dated baseline is still current.

Assess practical usefulness, ease/value prioritisation, dependency accuracy, unnecessary complexity,
missing user-visible outcomes, contradictions with current commitments, and clarity for an agent
with weaker judgement. Which early changes buy the most? Are sensible safeguards proportional to
the orchestrator's middle reliability tier? Is the plan clear about what to implement first and
where to stop? Does it preserve existing machinery and authorisations?

There have been two GPT Sol reviews (linked at the end), followed by a small upstream reconciliation.
Form your own view before consulting their conclusions; an earlier approval is not your verdict.
Do not request an implementation or a broad architecture rewrite merely because this is a roadmap.

Return:
1. A short overall judgement.
2. Concrete findings F1, F2, etc., ordered by consequence, with plan section, evidence, why it
   matters, and a specific suggested revision. Distinguish blockers from optional improvements.
3. The first useful delivery batch you would actually recommend, and what to defer.
4. Any claims you could not verify, and a final APPROVE / REVISE verdict.

Keep the review proportionate and actionable. Fewer well-supported findings beat speculative lists.
