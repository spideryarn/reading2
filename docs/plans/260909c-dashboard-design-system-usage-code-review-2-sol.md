No P0 or P1. The five fixes are sound; I would land `20f8c504`.

Two non-blocking P2 observations:

- [UsagePanel.tsx:717](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:717): the visible cache age is restored, but the stated “exact instant in the tip” is not. `USAGE_TIPS.cached` is static and never receives `cache.fetchedAt`. This does not undermine the freshness fix, but the fix description overclaims.
- [fleet-usage-card.test.tsx:589](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tests/fleet-usage-card.test.tsx:589): `95% used` with level `ok` cannot be produced by the current 80% threshold. The test still catches the intended mutation, so coverage is not weakened. A producer-valid follow-up would test `75% / ok` and `90% / approaching`.

Answers:

1. **UL-01 is safe.** The producer sorts confirmed live limits by reset time and publishes the latest one. Once `dueBackAt` has passed, no other positively attributed window in that report can remain active. A later unattributable window may exist, but it remains an explicit ambiguity in “Why”; hiding the cleared card does not claim that ambiguous window has cleared.

2. **Withdrawing the fold was correct.** Folding everything except today’s known names would still invent a future compatibility contract. Producer-side relevance classification is the proper prerequisite.

3. **Both broad arms should render `Unknown`.** `Withheld` and `Unavailable` having one precise caller each is evidence that those states now mean something specific, not a smell requiring broader use.

4. **22 / 17 / 13 reads as three levels.** The supplied 390px and 1280px captures show a clear answer/lead/body hierarchy. Calling 12 and 11 density variants is honest: their distinction is supported by role, weight, colour, casing, and position rather than pretending the 1px differences establish further hierarchy.

5. **The test edits did not weaken existing coverage.** The 2→3 count follows directly from restoring the absent window card, the withdrawn-fold assertions now pin the intended behavior, and the cleared-limit and rounding tests address the missing regressions. The colour mutation is now caught.

Requested test run:

```text
Test Files  3 passed (3)
Tests      34 passed (34)
```

No files were changed.