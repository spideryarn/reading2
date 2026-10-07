No newly introduced P0/P1 defect found. I made scoped fixes and left one inherited input-handling issue for your decision.

- **F1 — P2, established, not fixed: invalid and extreme word counts.** In [reading-time.ts](/home/greg/code/spideryarn2/.claude/worktrees/spine-reading-fainter-and-compressive/src/web/reading-time.ts:32), `readReach(1, NaN)` returns 16. `readReach(Number.MAX_VALUE, Number.MAX_VALUE)` returns 0 because multiplying words by 60 overflows; mathematically it should return 9. Both behaviors predate this commit. Fixing them would also change the gutter’s normalization, beyond this rail-only change.

- **F2 — P2, established, fixed: interior boundaries lacked protection.** All 117 original focused tests passed with a mutation that delayed the first interior transition by one double. I added literal endpoint assertions and tests immediately below, at and above every interior boundary. The mutation then failed at the intended assertion; the correct comparison is restored. [Tests](/home/greg/code/spideryarn2/.claude/worktrees/spine-reading-fainter-and-compressive/tests/reading-time.test.ts:131).

- **F3 — P2, established, fixed: duplicated start threshold.** `readLevel` independently spelled `0.35`, while the reach table used `READ_REACH_FROM`. Both now use the constant. The executable width scale lives in one module; I also replaced duplicated calibration details in the reference doc and code comment with signposts to the plan.

- **F4 — P2, reasoned, wording fixed: the tail’s explanation exceeded the evidence.** The histogram cannot distinguish repeated reading or thought from short blocks with a one-second expected-time floor. The [plan](/home/greg/code/spideryarn2/.claude/worktrees/spine-reading-fainter-and-compressive/docs/plans/261004j-spine-reading-chart-fainter-and-rarely-full.md:69) now states that limitation. A breakdown by word count and block type remains unverified.

- **F5 — P3, established, fixed: stale descriptions.** Corrected “reach moves three times inside each level,” the test’s “little over a third” description of 9/16, and “three slow reads” to “three reads at the expected pace.”

For ordinary word counts, the arithmetic checks out: NaN, negative and zero seconds return 0; negative words behave like zero words; huge seconds saturate at 16. Every threshold is strictly increasing in floating point, and the final table entry is exactly `READ_REACH_FULL`. Adjacent doubles at 0.35, 44.8 and every interior boundary behave correctly. Zero/non-zero agreement with `readLevel` holds for every numeric input by construction, including the inherited pathological cases.

The histogram totals **595**. Summing bins gives **255/595 = 42.857%** before and **16/595 = 2.689%** after. Thus **42.9% → 2.7% follows**. Near-full begins at approximately 29.9004, inside bin 25: the histogram bounds its share at **29–37/595, or 4.9–6.2%**. The reported 32/595 is consistent but cannot be reconstructed exactly. Six doublings leaves 7.9% full; eight leaves 0.7%. Seven is defensible for this sample, without proving generality.

Consumers are the hook, Reader’s wiring, Spine, and the run/path builders. I found no surviving runtime reliance on `floor(reach / 4) === level`; help text remains compatible.

The focused suite passes **118 tests**. Typechecking reports six unrelated diagnostics in `src/backfill-registry-facts.ts`; lint reports only existing complexity advice. The browser check remains outstanding. No commits or git mutations were made.

VERDICT: land after fixes