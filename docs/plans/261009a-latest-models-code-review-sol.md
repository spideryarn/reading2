Fixed the in-scope findings. Focused validation passed across 19 files: **779 tests** in their latest runs. All four typecheck projects passed via `node --import tsx scripts/typecheck.ts`; `npm run typecheck` hit tsx’s sandbox IPC restriction. The additional spend-audit suite remained blocked by `spawnSync git EPERM`.

1. **High — [run.ts:321](/var/tmp/spideryarn-worktrees/fbgdv6dk-models-and-digest/evals/digest/run.ts:321):** Budget halts could become zero-cost failures. Fixed propagation, abandoned-reservation handling, retry reservation coverage, and lock retention until workers settle.

2. **Medium — [run.ts:502](/var/tmp/spideryarn-worktrees/fbgdv6dk-models-and-digest/evals/digest/run.ts:502):** Resume trusted filenames and could reuse changed requests or overwrite paid failures. Added identity checks before spending, retained failures, and suppressed break-even estimates for incomplete matrices.

3. **Medium — [tally.ts:70](/var/tmp/spideryarn-worktrees/fbgdv6dk-models-and-digest/evals/digest/tally.ts:70):** Incomplete scores and mismatched keys could produce plausible averages. Added strict validation, output-bound exclusions, and protection against replacing already-judged packets. The saved tally still reproduces exactly.

4. **Medium — [pricing.ts:192](/var/tmp/spideryarn-worktrees/fbgdv6dk-models-and-digest/src/pricing.ts:192):** Sonnet 5.5 cache reads were priced at $0.20/M. Corrected to **$0.10/M**, added a regression, and corrected the plan’s rejected finding. [Anthropic’s migration guide](https://platform.claude.com/docs/en/models/sonnet-5-5/migration-guide) confirms the rate.

5. **Medium — [pdf-read.ts:381](/var/tmp/spideryarn-worktrees/fbgdv6dk-models-and-digest/src/pdf-read.ts:381):** Removing the historical reader row reduced GPT-5.6 Luna overrides to 30 MiB. Restored their measured 40 MiB allowance.

6. **Medium — [high-power-models.test.ts:63](/var/tmp/spideryarn-worktrees/fbgdv6dk-models-and-digest/tests/high-power-models.test.ts:63):** The existing test failed on the fidelity-guard pin. Corrected it and added pin/override, literal Sonnet-5 freshness, fixed-hash, and real-request quiz reasoning coverage. No additional affected quick job used a tiny ceiling with default reasoning.

7. **Medium — [investigation:155](/var/tmp/spideryarn-worktrees/fbgdv6dk-models-and-digest/docs/investigations/261009a-haiku-5-5-and-an-opus-digest-for-cheaper-models.md:155):** Narrowed conclusions to the sample, exposed failure-inclusive scores, and noted critical chat retains only Gwern. Corrected title agreement counts, the ~7.3k-token digest increase, and unsupported rewrite-cost claims; marked unarchived measurements as unverifiable here.

8. **Medium, wider scope — [investigation:188](/var/tmp/spideryarn-worktrees/fbgdv6dk-models-and-digest/docs/investigations/261009a-haiku-5-5-and-an-opus-digest-for-cheaper-models.md:188):** Corrected the claim that production cannot encounter Azure refusals: Anthropic preference permits fallbacks. Left provider-policy changes and Opus chat’s demonstrated 4,000-token cutoff outside this change. Fleet and Overseer remain unchanged as requested.

**Verdict: ready with these fixes; the additional spend audit still needs verification outside this sandbox.**