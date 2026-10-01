No P0 findings.

## P1

1. The guard can still lose a press.

The plan says the checker cannot make a press store nothing ([plan:46](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/docs/plans/261001i-simple-fidelity-guard-built.md:46)). But after a valid first output is flagged, the guard starts a second writer call. That call can fail at transport/refusal/truncation ([simple-summary.ts:617](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/simple-summary.ts:617)) or validation ([simple-summary.ts:661](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/simple-summary.ts:661)); the current all-or-none orchestration then aborts the press ([simple-summary.ts:670](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/simple-summary.ts:670)). Without the guard, the valid first output would have been stored.

Change: retain the first valid flagged output until the retry produces another valid level. If the guard-triggered writer retry fails for a non-abort reason, store the retained first output and record `retryFailure: "call" | "validation"`. If losing the press is actually intended, remove “never fails a press” and measure that availability cost.

Also distinguish the checker’s private 30-second timeout from the job/sibling signal. A timeout should become `unchecked`; a job or sibling abort must be rethrown. Add tests for both. The current test list does not test aborts.

2. The artefact cannot provide the promised historical rates.

A Simple rerun replaces the column on the same revision ([pipeline.ts:3870](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/pipeline.ts:3870)). Therefore the proposed report ([plan:120](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/docs/plans/261001i-simple-fidelity-guard-built.md:120)) sees only the latest check for each revision, not every flag or retry. Failed presses store no artefact at all, so their flags, unreadable answers, and retries disappear. `ai_calls` retains the calls but not their semantic verdicts ([plan:82](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/docs/plans/261001i-simple-fidelity-guard-built.md:82)).

That produces a survivor-biased snapshot, not flag/retry/failure rates over production calls.

Change: keep `check` on `SimpleSummary` as the audit record for the currently stored text, but add an append-only `simple_check_events` table for longitudinal instrumentation. One row per checked attempt should record article/job/run, level, writer attempt, outcome (`passed`, `flagged`, `call_failure`, `unreadable`), flag count, checker version/model, and timestamp—without article prose. This is the case where the new table rejected at [plan:169](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/docs/plans/261001i-simple-fidelity-guard-built.md:169) is justified. Leave `ai_calls` generic and use it for cost/transport accounting.

3. The tests do not yet prove that production sends the measured request.

The orchestration tests stub `openRouterJson`, so they can verify the caller’s body but not the gateway-owned reasoning and provider route. `reasoning` is injected later by `outgoing` ([ai-call.ts:1413](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/ai-call.ts:1413)), while the measured probe depended on the exact low-effort, `require_parameters`, no-`order` request ([probe:178](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/scripts/probes/261001h-fidelity-guard-probe.ts:178), [probe:203](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/scripts/probes/261001h-fidelity-guard-probe.ts:203)). Exhaustive registration proves that a row exists, not that it matches the measured row.

Change: add one transport-level test using the real checker plus a stubbed `fetch`, asserting the actual outgoing request has:

- the measured system and user messages;
- `max_completion_tokens: 4000`, with no `max_tokens`;
- `reasoning: { effort: "low" }`;
- `provider: { require_parameters: true }`, with no `order`;
- the quick-tier model.

Avoid an unchecked copy of the measured prompt: either share the pure prompt/renderer with the probe or pin the measured bytes with a literal snapshot/hash. Also include a default-on test that calls `generateSimpleSummary` without the injected override and observes three checker calls; otherwise changing the production constant to `false` could leave all explicitly-enabled guard tests green.

## P2

1. Validate the optional record and make impossible states unrepresentable.

`isUsableSimpleSummary` currently validates the whole stored contract ([types.ts:4739](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/types.ts:4739)). The plan only tests that missing `check` remains valid; it should also specify validation when `check` is present.

The proposed type permits impossible combinations such as `attempts: 1, retriedAfterFlag: true`. Add an `isSimpleCheck` validator and shape the union so `retriedAfterFlag: true` requires two writer attempts. Test malformed flags, paragraph indices, failure kinds, and impossible attempt combinations.

2. State the real spend bound.

A successful flag retry adds another writer call and, if that output validates, another checker call—not only another writer call as [plan:37](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/docs/plans/261001i-simple-fidelity-guard-built.md:37) says. The maximum is two writer calls and two checker calls per level: six of each per press. Concurrent work already started before a sibling fails may also incur cost, though `Promise.allSettled` correctly drains it.

Add exact call-count assertions for first flag/second pass, double flag, validation-then-flag, and first flag/second checker failure.

3. Clarify model provenance.

A single top-level `model` is ambiguous when several checker calls occur and OpenRouter can report a different answering model. Call it `requestedModel`; if the artefact needs actual provenance, store `answeredBy` per level/check. Otherwise rely on `ai_calls`, which already distinguishes requested and answered models.

## Direct answers

1. `check` on `SimpleSummary` is right for the currently stored text. It does not require a migration, does not affect `sourceHash` staleness, exports naturally ([export.ts:450](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/store/export.ts:450)), and the public DTO explicitly drops it ([dto.ts:527](/home/greg/code/spideryarn2/.claude/worktrees/simple-fidelity-guard/src/public/dto.ts:527)). No `SIMPLE_VERSION` bump is needed. It is not sufficient as the historical metrics store.

2. Validation-then-flag correctly exhausts the two-writer budget. The missing cases are guard-triggered writer failure and careful separation of deadline aborts from job aborts.

3. The new job registration is structurally sound: `Task`, tier, wire, model override, route, reasoning, cost disposition, and plain-words exemption are the right sites. Give it `step-driven` cost disposition and `modelFor("simple-check", "standard")`. The missing protection is the exact outgoing-request test.

4. A code constant is a reasonable beta off switch because both code and environment changes require a Vercel deployment. Keep one production default and test it without injection.

5. The proposed tests cover the ordinary state machine well, but are not yet enough for silent success. Add the default-on, real outgoing-request, abort-versus-timeout, guard-triggered writer-failure, malformed stored-check, and second-check-failure cases.

Verdict: **not ready to build until the three P1s are resolved**. The core guard and artefact choice are sound; the gaps are availability, durable measurement, and proving that production runs the request that was actually measured.