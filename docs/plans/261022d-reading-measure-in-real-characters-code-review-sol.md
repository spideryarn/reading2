VERDICT: ship with fixes (made)

1. Fixed a silent-success hole in [measure-line-length.ts](/var/tmp/spideryarn-worktrees/fbvywcpu-reading-measure/scripts/measure-line-length.ts:37). It now rejects missing measure instrumentation, implausibly small counts, and measure-bound medians below the documented 45-character floor—not only overly long lines.

2. Corrected stale 65ch-derived statements in the token, layout measurement, gutter, masthead, and test comments. The held `PROSE_ALONE_MAX_REM = 49` remains unchanged and is now consistently described as deliberate slack.

3. The width CSS is safe. Callouts are exactly 49 upright `ch`; blockquotes resolve `ch` in italic Source Serif and are approximately 50.1 body `ch`, still about 52px narrower at Default. I corrected the exact “7 body ch” wording in [prose.css](/var/tmp/spideryarn-worktrees/fbvywcpu-reading-measure/src/web/styles/prose.css:810). Masthead, gutter, footnote, Quiz, and Skim geometry continues to resolve the token in the prose face.

4. I found no clipping or overlap defect from `line-height: 0`. Prose ancestors permit overflow, canonical footnote markers occur within ordinary text, and coarse-pointer markers retain their explicit 28×40px target. Exact browser focus-ring geometry could not be re-observed because Chrome is blocked by this sandbox’s seccomp, but the static structure and existing 31px → 27/28px evidence support shipping.

5. The two `it.fails` tests are sound rather than vacuous: their parsed inputs are independently asserted by ordinary tests, they fail specifically on excessive cap slack, and changing the cap to 34 makes them unexpectedly pass—therefore turning the suite red as intended. No change was needed.

6. Verification: four focused suites passed—66 tests plus 2 expected failures. Direct typechecking covered all 3,930 source files. Lint had no errors; only two existing complexity advisories. `git diff --check` is clean. No commit was made.