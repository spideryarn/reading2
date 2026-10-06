1. **Numbers:** All judgment counts, screen counts, hashes, and the $3.901166 total recompute. Exceptions:
   - “One in fifteen” was wrong: 36/438 is **8.2%**, about one in twelve; strict-by-both is 24/438, **5.5%**.
   - The reported balances, $112.67 and $108.74, have no saved snapshot. Their $3.93 difference is arithmetically correct but cannot be independently verified.

2. **Scorer:** Correct for these files. I independently checked joins, cue-to-side mapping, subsets, hash sampling, and thresholds. The sign test matches exact binomial calculations across 3,828 cases. All six regenerated pairs/key files were byte-identical; generated marking sheets were removed.

3. **Conclusion:** “Did not pass; skim/10 stays” is supported. Dangling comparisons give p = **0.200** and **0.690**; the candidate also exceeds both overall fault tolerances against A2. Under strict-by-both, p = **0.503** and **1.000**, so rejection remains. Restricting the overall sample to those 24 plus 50 ordinary quotes still fails misstatements: **C 5, A2 1, allowance 2**.

   The widened definition, screened first draft, single candidate run, and same-family judges are disclosed fairly after edits. Their chronology and judge identities are reported in prose rather than independently established by the JSON.

4. **Quotes-step suggestion:** Previously phrased too strongly as where the evidence pointed. It now explicitly says this is an **untested suggestion**.

5. **Source:** `src/skim.ts` is byte-identical to `origin/dev`, SHA-256 beginning `3987d5b6e7ca598d`. No prompt change shipped.

Validation passed: independent scoring, 17 documentation tests, full typecheck, and diff whitespace checks. Only the three docs were edited; the scorer needed no fix. No paid calls, database access, or Git writes.

VERDICT: ready

- **P2 — Fixed:** Incorrect prevalence and unsupported generalisation beyond the sample.
- **P2 — Fixed:** Claims of no improvement, no ordinary change, and no additional scenes exceeded the evidence. Replaced them with measured limits and added strict-by-both sensitivity results.
- **P3 — Fixed:** Made the Quotes-step idea explicitly a suggestion, qualified unsnapshotted balance figures, and carried the measurement limitations into both summaries.