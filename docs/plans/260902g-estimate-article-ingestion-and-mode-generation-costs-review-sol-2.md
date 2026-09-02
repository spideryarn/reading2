1. **Resolved.** The historical duplicate-execution incident is correctly separated from current hierarchy variability. Three to five interleaved cold draws support “observed variation,” not a tail estimate. Remove the opening promise of “a tail to $Z” to stay consistent.

2. **Not fully resolved.** Slug-first attribution is the right evaluation order, but slugged `job_step` rows would still be classified as **Product spend** by `scripts/ai-cost.ts:423`. Attribution works; accounting isolation does not. Make eval/product separation an explicit feasibility acceptance criterion. This may still require a coordinated seam or reporting change.

3. **Resolved**, except the Goal still says this plan enables model comparison. Say model comparison requires the follow-up arms plan.

4. **Resolved.** Named observations and clearly labelled extrapolations are now defensible at planning precision.

5. **Resolved.** The ranking was adopted faithfully. Clarify that the duplicate-execution concurrency test belongs to the separately owned investigation, not this plan.

**Verdict: approve with changes** — fix the three scoped wording/design points above. The only substantive new issue is `job_step` eval spend contaminating Product spend.