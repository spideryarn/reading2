# Narrow second review of roadmap corrections

Read-only. Do not change files, invoke a live action, launch sessions or restart services.
Review only whether corrections resolve R1–R7 in:
docs/plans/260908f-overseer-and-fleet-improvement-roadmap-review-sol.md

Live candidate, base 4adcdfd62703b6565a27a03c50f20f8a215f1bd8, explicit new/untracked paths:
- docs/plans/260908f-overseer-and-fleet-improvement-roadmap.md (revised candidate)
- docs/plans/260908f-overseer-and-fleet-improvement-roadmap-baseline.txt
- docs/plans/260908f-overseer-and-fleet-improvement-roadmap-validation.txt
- docs/plans/260908f-overseer-and-fleet-improvement-roadmap-review-prompt.md
- docs/plans/260908f-overseer-and-fleet-improvement-roadmap-review-sol.md
- docs/plans/260908f-overseer-and-fleet-improvement-roadmap-review-followup-prompt.md (this brief)
No code changes. This turn writes only a plan; no implementation is authorized by this artifact.

Corrections to inspect:
R1: Scope now explicitly distinguishes future implementation authorization for reversible isolated
fixtures/test-socket work from separately authorized shared-live targets. Existing session permissions
persist; don't mandate asking again for already authorized actions. Default delivery test isolated.
R2: Added Execution identity stage before dependent stages: verified/claimed-only/unknown, current
harness process+boot/PID/start ticks, separate conversation verification, propagate wire/store/guards,
quarantine old UI state and refuse identity-dependent writes when verification missing.
R3: Recovery candidate event includes final full RegisterEntry BEFORE removal; idempotent ordered
batch/replay, durable recovery projection/register, disposition/retention/pagination, no silent expiry,
old-log replay once and crash boundaries.
R4: Added Launch protocol foundation shared scheduling/recovery, explicit sequential journals,
idempotent admission reservation, initial-effect correlation in tmux and headless wrapper, durable
artifacts for fast disappeared children, unknown/no retry/reservation reconciliation. No claimed
atomic operation across store, reservation and spawn.
R5: Explicit preview schema/id/instance/action revision/expiry/material; bounded volatile preview map,
reject after restart/expiry/mismatch, retain op/action in parser, fresh guards separate.
R6: Operation-specific keys-submitted, command-exited and effect-observed variants with partial/unknown.
R7: Default section order now goes attention -> necessary responsiveness -> resource history/admission
-> usage, then optional lifecycle/full transport/source ordering/refactor before later launch work.

For each R1–R7 return resolved or still open with a short reason. Do NOT reopen a general code audit.
If an established P0/P1 in these corrected instructions remains, identify the exact sentence and
smallest concrete correction; distinguish genuine impossibility from implementation detail left for
the later stage. Plan is deliberately detailed for a less-capable agent, not a final protocol spec.
Severity by consequence: P0 data loss/security/broad outage; P1 user-visible wrong behavior or violated
authoritative contract; P2 maintainability/design risk; P3 prose. Refuse only established P0/P1, with
no material inferred premise. Finish APPROVE / APPROVE WITH CHANGES / REVISE. No test rerun needed for
prose-only corrections; parent reruns doc-links. The resulting commit SHA will be recorded afterwards.
