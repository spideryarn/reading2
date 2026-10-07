**Verdict: ship with the fixes made.**

1. **F1 — P1, established, fixed:** [halvingCut](/home/greg/code/spideryarn2/.claude/worktrees/structure-fallback-notice/src/structure-slices.ts:180) checked the midpoint before heading snapping. Consecutive headings could turn a 300-block slice into “halves” of 1 and 299 blocks, including a forbidden seam after a heading. It now checks the snapped cut and returns `null` when no safe central cut exists. Regression seen red, then green.

2. **F2 — P2, established, fixed:** [second-pass counting](/home/greg/code/spideryarn2/.claude/worktrees/structure-fallback-notice/src/structure-slices.ts:693) counted selected retries before admission. A blocked retry reported 1; eight admitted retries reported 10. It now counts each logical slice once when a settled call reports positive transport attempts. Both regressions were seen red, then green.

3. **F3 — P2, established, fixed:** [fallback arithmetic](/home/greg/code/spideryarn2/.claude/worktrees/structure-fallback-notice/evals/long-structure/fallback-arithmetic.ts:12) incorrectly called the independent-failure result a lower bound. If every call shares one failure event with probability 10%, fallback is 10%, below the table’s 42.7%. Removed that claim and clarified the assumed per-pass rate. **The formulas and every table number are correct under the stated independence and equal-rate assumptions.**

4. **F4 — P3, established, fixed:** [the plan](/home/greg/code/spideryarn2/.claude/worktrees/structure-fallback-notice/docs/plans/261005j-long-document-structure-arrives-top-level-first-then-sections-then-summaries.md:292) said the dry refusal scenario remained intentionally red, although `dry.ts` already expected successful halving. Corrected.

**Restore none of the 16 rewritten expectations.**

Seven changes only add `secondPass: 0` in [structure-step-slices.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/structure-fallback-notice/tests/structure-step-slices.test.ts:235): lines 235, 294, 336, 350, 378, 386 and 630.

The nine substantive changes deliberately reverse earlier behavior:

| Test location | Assessment |
|---|---|
| Adversarial:60, invalid start | Third attempt is the new second pass; invalid coverage still fails. |
| Adversarial:200, F26 | Recoverable failure now permits admission; terminal-failure admission remains pinned. |
| Adversarial:222, rejecting peer | Count 2→4 includes retries; waiting assertion remains. |
| Adversarial:284, F28 | Keeping failed-refill sections is explicitly authorized. |
| Step:299, twice-invalid answer | Third-attempt recovery is intended; three failures still fall back. |
| Step:356, failed refill | Original section remains, as required. |
| Step:392, F17 | Count 4→5 includes the extra retry; settlement and checkpoint assertions remain. |
| Step:421, first failure | Remaining slices continue, followed by one retry; terminal failure is separately tested. |
| Step:449, refusal/truncation | Halves replace fallback; their coverage and seam are checked. |

After the fixes, I found no additional admission, settlement, Stop, usage or transport-attempt accounting defect. Optional refill timeouts still leave subsequent calls subject to deadline admission. The previously documented F29 limitation—uncapped checkpoint I/O—remains unchanged.

Half coverage is checked independently, and the midpoint reaches the caller’s seam check. Markers cannot be mistaken for answers by either version: answer readers require a string `answer`. Changed request bytes invalidate the key; successful halves retain the marker so later runs skip the refused parent. Sequential halves and terminal handling of unhalvable refusals are reasonable.

**Files changed by this review:**

- `src/structure-slices.ts`
- `tests/structure-slices-second-pass.test.ts`
- `evals/long-structure/fallback-arithmetic.ts`
- `docs/project/structure-step.md`
- The stage 1a plan
- [Root-cause write-up](/home/greg/code/spideryarn2/.claude/worktrees/structure-fallback-notice/docs/postmortems/261005n-a-later-transformation-invalidates-a-checked-candidate.md)

**Validation:** all six authorized slices/limits suites passed individually: **95 tests**. Typechecking passed using the permitted `node --import tsx` fallback after the wrapper’s IPC permission failure. Arithmetic and whitespace checks passed. Lint reported two complexity advisories.

No commits or Git mutations performed.