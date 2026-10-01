# Plan review: Simple's fidelity guard, built (261001i)

Review the plan docs/plans/261001i-simple-fidelity-guard-built.md before it is built. Read-only.

Background and evidence, read these:
- docs/plans/261001h-plain-words-summaries-keep-the-piece-s-contrasting-terms.md, especially "## The guard" and "## Measuring the guard (2026-10-01)" and its recommendation.
- scripts/probes/261001h-fidelity-guard-probe.ts — the checker prompt and request that were measured (Luna through link-summary's route).
- src/simple-summary.ts (writeLevel, LEVEL_ATTEMPTS, generateSimpleSummary), src/types.ts (SimpleSummary, isUsableSimpleSummary), src/public/dto.ts (publicSimpleSummary), src/quiz-verdict.ts (an existing quick-tier openRouterJson job), src/ai-call.ts (openRouterJson, route policy, CHAT_REASONING), src/models.ts (job registry), src/db/schema.ts (ai_calls), docs/project/cost-tracking.md.

The brief: after each level, one checker call (each paragraph with its cited blocks, one verdict each); on a flag retry once, then store the second attempt whatever its verdict and record the flag; on checker error store unchecked and record it; instrument flag rate, retry rate and checker failures so they are queryable later through the existing cost tracking / ai-call path where one fits; one obvious off switch. No change to the Simple prompt or other voices.

Questions I most want answered:
1. Is putting the verdict record on the artefact (an optional `check` field of SimpleSummary) right, versus a column on ai_calls or a new table? Will it break any read boundary, staleness check, export, public DTO, or the client?
2. Is the retry/budget logic correct, including the validation-then-flag case, aborts, and fail-open? Any path where the guard can lose a press or spend more than planned?
3. Is reusing the probe's exact request (chat wire, effort low, max_completion_tokens 4000, require_parameters) as a new `simple-check` job sound? Anything the registration will miss?
4. Is a code constant the right off switch?
5. Are the tests enough to catch silent success (a guard that never actually checks)?

Give P0/P1/P2 findings with file:line where possible, then a verdict. Be concrete; say what you would change.
