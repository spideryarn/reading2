No P0 or P1 findings.

- **P2 — [replay-floors.mjs.txt:43](evals/results/quick-search-lower-floors-2026-10-04/replay-floors.mjs.txt:43): replay mishandled ties and empty-list fallback flags.** JSON order changed one capped selection. Fixed fixture ties to article order and matched `hitsFrom` on all 246 fixture runs. Regenerated results: fallback precision is **62% before, 55% after**, rather than 61%/54%. Production-only articles’ tie order remains unverified.

- **P2 — [pool3.mjs.txt:32](evals/results/quick-search-lower-floors-2026-10-04/pool3.mjs.txt:32): saved judge answers erased the regenerated candidate pool.** Fixed classification to use earlier labels only, and honored `QOUT`. Regeneration preserves exactly 254 candidates, 86 overlaps and 97 decoys.

- **P2 — [plan:30](docs/plans/261004k-quick-search-lower-floors-so-more-shows-up.md:30): the threshold conclusion was stronger than the evidence.** At 0.6, cumulative working-search additions are still 69/137 right; bare queries are 61% right in the next lower band. Qualified the rationale across the docs and comments. **I would choose the same numbers**, using the quality of each additional band; the sample does not establish a unique optimum.

- **P3 — [investigation:44](docs/investigations/261004d-quick-search-lower-floors-precision-by-score-band.md:44): “the cliff did not grow” was unsupported.** Three queries cross the ordinary floor before and after, but they differ. Mean list-size spread rises from 0.85 to 0.90. Replaced the claim with those measurements.

- **P3 — [investigation:80](docs/investigations/261004d-quick-search-lower-floors-precision-by-score-band.md:80): judging provenance and coverage were overstated.** Earlier labels also left old-list gaps. Complete fixture coverage stops at fallback 0.35; fallback 0.3 has three unjudged occurrences. Corrected the wording. Chosen-rule coverage remains complete.

- **P3 — [analyse3.mjs.txt:16](evals/results/quick-search-lower-floors-2026-10-04/analyse3.mjs.txt:16): unrequested answers did not fail validation.** Fixed the guard. Saved answers contain no extras.

Verified the working bands **86/62/38/27/13**, passage counts, **107/111 versus 99**, six shorter searches, **70/86 agreement**, and **0/97 decoys**. Verdict joins are correct; the pool hides scores and uses article order. Remaining old thresholds describe historical measurements.

All 48 requested tests and touched-file lint pass. Typecheck passes through Node’s `tsx` loader; the `npm` launcher was blocked by the sandbox’s socket restriction.

**Land with these corrections: 0.65/0.4 are defensible, and the revised evidence states their costs honestly.**