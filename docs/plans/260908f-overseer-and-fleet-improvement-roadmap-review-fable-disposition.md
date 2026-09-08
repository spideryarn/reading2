# Fable review: disposition and validation

Up: [roadmap](260908f-overseer-and-fleet-improvement-roadmap.md).
The [prompt](260908f-overseer-and-fleet-improvement-roadmap-review-fable-prompt.md) reviewed candidate
`b6fb68844bd6ffb044098bd19b6300f8caa1029f`; the [answer](260908f-overseer-and-fleet-improvement-roadmap-review-fable.md)
is preserved as returned. This is a plan revision, not implementation of its proposed fixes.

## Review provenance

Greg requested Fable through `docs/reusable/claude-cli-as-subagent.md`. Ran the repository wrapper
with `--model fable --effort high --access read-only --timeout-minutes 30`, using `node --import tsx`
and the existing machine login. CLI init reported **`claude-fable-5-1`**. Wrapper exit **0**;
result event `subtype=success`, `is_error=false`; nonempty answer; 45 turns; no permission denials.
The wrapper reported $4.4007 (its reported usage cost, not a claim about an additional subscription
charge). Fable's verdict was **REVISE**, mainly for sequencing and proportionality.

## Findings checked and decisions

| Finding | Decision and reason |
|---|---|
| F1: identity gates read-only value | **Accepted with a narrower join.** Global status ships without execution identity. Existing generation/claim matches may show explicitly claimed history, but cannot establish a current child's age or confer write authority: a replacement child can inherit all those claims. Attention inspection no longer waits for Work evidence or verified continuity. Full identity still gates verified drafts and newly enabled identity-dependent writes. |
| F2: drop most preview binding; compare PID elapsed age | **Declined.** Source confirms elapsed age is available, but it is not identity: a replacement can outlive the age of the original at preview. A server restart marker alone does not bind action revision or exact reviewed material within the same lifetime. Retain actual start identity and the bounded volatile preview envelope required by the earlier Sol review. Keep that work off the read-only delivery path so the safety requirement does not postpone useful status. No durable workflow machinery is added to this early repair. |
| F3: name the Attention producer | **Accepted.** Daemon owns the question/duration list; the fleet boundary projects it and the browser renders it. Dashboard-local additions are visibility failures, not a second question detector. |
| F4: unnecessary Baseline handler extraction | **Accepted.** `browserFetch(routes)` already exercises the real client/route join in `tests/fleet-actions-route.test.ts`. Move the conditional handler-composition seam to Access review, where prefix/routing tests need it. |
| F5: move two client fixes forward; change SSE policy | **Partly accepted.** Bring failed-poll termination and refresh-on-changed-conversation-claim into Baseline, including stale-response and old-view handling; neither is described as solving verified execution continuity. Retain close-on-backpressure for SSE. A drain guard could work but needs a latest-state/catch-up policy and must cover heartbeats too; the chosen immediate close plus cached reconnect remains the smaller bounded policy. Future measured reconnect churn can justify a drain-aware alternative. |
| F6: cheap misdirection cards | **Accepted conditionally on evidence.** Add current-work context hints without claiming wrongdoing; primary checkout is allowed for planning/docs. `tools/overseer/observation.ts` explicitly says `meta.dir` is the launch directory and can stay primary after `EnterWorktree`. Do not treat it as current cwd, or commit age as time since push. Missing evidence defers the hint rather than creating an extra collector. |
| F7: classifier credential and quota | **Accepted.** Name the existing Claude wrapper, make the configured credential source inspectable without secrets, show quota refusal/backoff rather than a successful empty scan, and preserve mechanical supervision when inference is unavailable. No silent switch to metered credentials. |
| F8: put the executable default first | **Accepted.** Add short delivery cuts under Goal and scope: status first, attention next, control repairs alongside, then resources/usage, with later scheduling/recovery conditional. Each cut has an honest stop line; the active Wave 2 work remains commissioned. |

Checked the cited request tests, kill parser/route, recent-message hook, launch poll, observation
metadata contract, and direction against the shared tree (HEAD `22f801b4` during revision; the only
commit since the candidate changed an unrelated plan). `git show 1534a908 -- tools/fleet/wire.ts`
confirms that commit added the wire module. `git show 3df3e833 -- tools/fleet/wire.ts` has no diff;
the roadmap's provenance remains accurate even though Wave 2 names another integration commit.

Before pushing, fetched and fast-forwarded to `3ba58fc5`. Dictation and its browser-leaf import
exception landed concurrently. Updated the roadmap's integration note and convenience rows to
preserve that code, its real-device verification gap, and Wave 2's now-explicit realtime partner.
Also made the optional work-context hints expressly follow Wave 2's question work; its misdirection
deferral is not silently overturned. These are upstream reconciliations after Fable's review.

This adjudication follows two completed Sol rounds. The changes reduce the early read-only scope
and clarify ownership; they preserve Sol's identity/preview invariants and introduce no runtime
implementation. Fable has not reviewed the revised snapshot; the table records the parent's
decisions rather than inventing a second approval.

## Validation

`node node_modules/vitest/vitest.mjs run tests/doc-links.test.ts --maxWorkers=1` passed:
**14 tests**, 1 file, 7.96 seconds, 2026-09-08 at 13:58 Europe/London. The named roadmap diff passed
`git diff --check` and was read against HEAD. Prior typecheck, focused-test baseline and broad-gate
limitations remain in the roadmap's linked validation file; this documentation-only revision makes
no new runtime correctness claim. No code, service, or live session was changed.

After upstream integration, the same document-link command passed again: **14 tests**, 5.05 seconds,
14:01 Europe/London. The staged-revert guard passed with git access; its initial sandboxed attempt
could not write the index lock. Only the plan, review prompt, answer and this disposition are committed.
