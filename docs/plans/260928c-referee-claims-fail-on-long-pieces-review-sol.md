The diagnosis is right for the observed 8,290-word failure, and stage 1 sends the intended request. The empty 12k artifact plus the larger successful responses support the causal story; the focused test passes 20/20. Anthropic also documents that Sonnet 5 thinks by default when thinking is omitted and recommends lowering effort or treating `max_tokens` as the hard ceiling. OpenRouter’s `require_parameters` selects endpoints that claim to support the sent parameters; it cannot guarantee a defect-free implementation. [Anthropic](https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/prompt-templates-and-variables), [OpenRouter](https://openrouter.ai/docs/guides/routing/provider-selection).

F1 — P1: the deadline cannot fit the budget it claims to protect.

Where: [src/referee-claims-run.ts:159](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/referee-claims-run.ts:159), [src/referee-claims-run.ts:194](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/referee-claims-run.ts:194), [tests/referee-claims-run.test.ts:175](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/tests/referee-claims-run.test.ts:175).

`CLAIMS_ANSWER_ROOM` is 23,400; with 16,000 reasoning tokens the request permits 39,400 completion tokens. At the plan’s 110 tokens/s that is about 358 seconds, or 448 seconds with the test’s 25% margin. The new 300-second deadline therefore kills precisely the “medium actually thinks and then writes a large answer” case.

Fix: derive the deadline from the full answer-plus-thinking budget. Keeping the current numbers implies roughly 450 seconds. The test should use `max_tokens`, not answer tokens alone.

F2 — P2: the answer and thinking figures are estimates presented as bounds.

Where: [plan:55](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/docs/plans/260928c-referee-claims-fail-on-long-pieces.md:55), [src/referee-claims-run.ts:185](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/referee-claims-run.ts:185), [src/referee-claims.ts:269](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/referee-claims.ts:269).

The caps bound row counts, not token length. Claim text, exact quotes, and reasoning strings have no character limit, so 19k/23.4k is not “the largest answer the caps allow.” Likewise, 16k is a reasonable rollout buffer for this 20k-token prompt—above the observed 8k–13.2k unrestricted/high thinking—but it is not evidence about a 30,000-word article or a long PDF.

Fix: call it an empirical estimate, use `budgetFor` so the model ceiling is enforced, and exercise the longest HTML and PDF fixtures before declaring a supported envelope. Retaining 16k is defensible for this rollout with telemetry; increasing it blindly is not automatically safer because a reasoning model can use the extra allowance. If the intended guarantee includes substantially longer papers, choose a measured larger headroom or an explicit size boundary.

F3 — P1: the medium-effort eval’s sole “adequacy failure” is actually a fail-safe false positive.

Where: [eval result:40](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/evals/results/referee-claims-effort-medium-260928.md:40), [eval result:55](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/evals/results/referee-claims-effort-medium-260928.md:55), [src/referee-claims.ts:640](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/referee-claims.ts:640).

“States that no cross-domain transfer experiments were performed” faithfully restates the paper’s “we did not run the transfer experiments.” It is not an adequacy verdict, despite being labelled “the paper contains no such thing.” The regex matches `no … experiments were` even after “states that,” and the reader loses a useful linkage sentence.

This is not evidence that medium reasoning weakens the linkage rule. It is deterministic classifier overreach exposed by different phrasing.

Fix: narrow that frame—most simply, anchor its `no … experiment …` arm at the start as the adjacent scope frame does—and add this exact sentence as a silent regression case.

F4 — P1: the remaining no-text copy directs Claims to a nonexistent control.

Where: [src/messages.ts:2607](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/messages.ts:2607), called from [src/referee-claims-run.ts:695](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/referee-claims-run.ts:695).

“Ask about a shorter stretch” is impossible in Claims. The repo already solved the identical distinction for mid-JSON overflow with `ANSWER_OVERFLOWED_FIXED_ASK`.

Fix: add a fixed-ask version of the no-room failure and have Claims opt into it. It should offer only an action the panel actually has—probably retry, with suitably cautious wording—and no narrowing advice.

F5 — P2: criteria is the right next scope, but “the same fix” is underspecified and unsupported for literature criteria.

Where: [plan:103](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/docs/plans/260928c-referee-claims-fail-on-long-pieces.md:103), [plan:121](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/docs/plans/260928c-referee-claims-fail-on-long-pieces.md:121), [src/referee-criteria-run.ts:532](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/referee-criteria-run.ts:532).

The two `single` measurements at 85–94% make criteria a justified extension. But literature has tools, a different 6k ceiling, different clocks, and no measurement; it may benefit from more reasoning after searches. Applying one medium policy to all three kinds could reduce result quality or leave literature’s timing problem untouched.

Fix: specify separate budgets, efforts, and clocks for `single`/`diverging` versus `literature`. Measure and evaluate literature before changing its effort; do not infer it from the single-kind run.

F6 — P2: stage 3 needs an enforceable decision, not merely a guard test over today’s files.

Where: [plan:106](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/docs/plans/260928c-referee-claims-fail-on-long-pieces.md:106), [src/ai-call.ts:1087](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/src/ai-call.ts:1087).

A concrete mechanism:

- Introduce a `WholeArticleJob` set and an `openRouterArticleStream` entry point.
- Require each call to pass a discriminated decision:
  - `{ kind: "bounded", effort, answerTokens, thinkingTokens }`; the gateway constructs `reasoning` and `max_tokens` through `budgetFor`.
  - `{ kind: "provider-default", maxTokens, rationale }`; this preserves existing behavior explicitly.
- Make the job-to-policy map exhaustive with `Record<WholeArticleJob, …>`. Existing seven features can be entered as `provider-default`, so the migration changes no quality setting.
- Give `Meter` the requested ceiling and declared headroom. Centrally warn when `finish_reason === "length"` and `reasoningTokens > 0`, and when reasoning exceeds declared headroom. Log only job/model/counts.

That prevents an answer-only ceiling from being accidental while preserving deliberate defaults. It also catches an upstream that advertises `reasoning` support but ignores its intended effort.

F7 — P2: the tests inspect the real outgoing body, but do not pin the decisions the plan makes.

Where: [tests/referee-claims-run.test.ts:204](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/tests/referee-claims-run.test.ts:204), [tests/referee-claims-run.test.ts:209](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/tests/referee-claims-run.test.ts:209).

The body inspection is sound. However:

- The effort test permits `low`, although the plan explicitly rejects low.
- The budget test requires only 8k thinking room, not the implemented 16k.
- The clock test ignores reasoning, causing F1.
- The planned reasoning-only `length` logging test was not added.

Fix: assert exact `medium`, assert the named computed budget and model ceiling, size the clock from that total, and add an SSE case containing reasoning plus usage, no content, `finish_reason: "length"`, and `[DONE]`, then inspect the structured error log.

F8 — P2: the evidence is not fully reproducible, and a canonical eval was unintentionally overwritten.

Where: [evals/scratch-claims/repro.ts:31](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/evals/scratch-claims/repro.ts:31), [evals/scratch-claims/live.ts:8](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/evals/scratch-claims/live.ts:8), [evals/results/referee-claims.md:1](/home/greg/code/spideryarn2/.claude/worktrees/referee-claims-long-pieces-0928/evals/results/referee-claims.md:1).

The scripts print token/time/cost summaries but do not retain them. The raw answer files substantiate empty/parseable output and the claim/passage counts—I reran the validator successfully—but not the table’s usage, timing, cost, or the two full `runClaims` executions. Separately, `git status` shows the old canonical eval modified even though it is absent from the candidate inventory; its history has been replaced by a partial rerun with several `_Not run._` sections.

Fix: retain a small redacted JSON/Markdown run summary with commands and usage numbers, preserve the new medium eval under its new filename, and restore the historical canonical eval before committing.

Verification: `npx vitest run tests/referee-claims-run.test.ts` passed, 20 tests.

Verdict: build with changes.