The original work is mostly present, but the blanket “all three are closed” is too strong. Two incorrect accounting/reporting behaviours remain today.

### Findings

- **F1 — P1 — [plan:762](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/docs/plans/260902g-cost-tracking-that-can-set-a-price.md:762), [ai-spend.ts:309](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/src/ai-spend.ts:309)**  
  The ledger knowingly records a paid-looking call as settled `$0` when `cost=0`, `upstream>0`, and `is_byok` is false or absent. The upstream figure is dropped, while non-null zero credits make the SQL treat it as priced. [The tests explicitly preserve this behaviour](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/tests/ai-call-images.test.ts:288); only a server-log warning exposes it.  
  **Smallest fix:** reopen ledger correctness and project this inconsistent shape as `cost_source='none'` with null credits/BYOK cost, retaining the warning. Change both false/null tests to require an unpriced row.

- **F2 — P1 — [plan:764](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/docs/plans/260902g-cost-tracking-that-can-set-a-price.md:764), [ai-cost.ts:1331](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/scripts/ai-cost.ts:1331)**  
  Ordinary `npm run cost` defines Product as every scope except `eval`, so `cli` spend is labelled Product. That contradicts [the classifier](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/src/cost-categories.ts:157), which correctly treats CLI as non-product. The `--owners` pricing report is correct, but its sibling report is not.  
  **Smallest fix:** define Product as `request | job_step`; print `eval | cli` as Non-product, or add a separate CLI pocket. Add a CLI fixture test over an extracted scope-partition function.

- **F3 — P1 — [plan:870](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/docs/plans/260902g-cost-tracking-that-can-set-a-price.md:870)**  
  `provider_account` identifies useful bill groupings, but not cap coverage. Direct `anthropic` and `openai` rows are outside OpenRouter’s cap; additionally, BYOK money remains under `provider_account='openrouter'` while `byok_upstream_nanos` was charged elsewhere. Unmetered outside-account spend has no numeric row at all. An arbitrary report window also cannot establish position against a monthly cap.  
  **Smallest fix:** retain credential grouping and add provider account plus the three money pockets. Prefer per-account recorded subtotals and a fixed note over an “outside-cap total.” If a total is retained, call it **recorded known-dollar spend outside the cap**, include direct Anthropic/OpenAI plus OpenRouter BYOK, and state that unpriced/unmetered spend is missing. Explicitly say the report cannot see the cap amount or remaining headroom.

- **F4 — P2 — [plan:863](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/docs/plans/260902g-cost-tracking-that-can-set-a-price.md:863)**  
  `AI_JOB_WIRE` is transport inventory, not scope inventory. The proposed binary partition risks encoding the wrong fact. In particular, production `pdf`, `pdf-frontmatter`, and `illustrate` run inside job-step collectors and are classified by `step_name`; yet `pdf` is currently in the interactive-request allowlist. `env-proposal` is CLI, `eval` is eval-only, and live conversation is request-scope but intentionally Voice.  
  **Smallest fix:** use `AiJob` for compile-time exhaustiveness, but record expected production classification behaviour: interactive request, step-driven, voice, or no product path. Place `link-summary` as interactive; `live_conversation` as voice; `pdf`, `pdf-frontmatter`, and `illustrate` as step-driven; `env-proposal` and `eval` as no-product. Eval overlays may still contain any job, and unexpected/historical combinations should remain `unknown`. A database-row guard would detect this only after money was spent, so compile-time remains the right delivery mechanism.

- **F5 — P3 — [plan:830](/home/greg/code/spideryarn2/.claude/worktrees/cost-tracking-price/docs/plans/260902g-cost-tracking-that-can-set-a-price.md:830)**  
  The claim that dictation is moving onto the direct OpenAI account is stale. The completed work kept production dictation on OpenRouter; only the comparison probe calls OpenAI directly.  
  **Smallest fix:** remove that sentence or replace it with the current state.

Stages 6 and 7 are not over-building if kept to the typed disposition table and an extension of the existing coverage tally. No dashboard, scheduler, cap machinery, or second report is warranted.

Leaving the real live-conversation proof outstanding does not block these stages. The plan already distinguishes structural implementation from empirical verification; retain that qualification until a microphone run produces both realtime and transcription rows.

The focused suites passed: 80 tests across cost categories, cost reporting, CLI arithmetic, and image-call accounting. Notably, the image suite passes while demonstrating F1. A Sol cross-check independently confirmed F1–F4.

*approve after these revisions*