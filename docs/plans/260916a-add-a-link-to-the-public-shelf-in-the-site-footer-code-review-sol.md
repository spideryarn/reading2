Found and fixed four issues, all in comments/docs rather than runtime behavior. Full ranked findings, checks, and applied fixes are in [code-review-sol.md](/home/greg/code/spideryarn2/.claude/worktrees/footer-public-shelf-link/docs/plans/260916a-add-a-link-to-the-public-shelf-in-the-site-footer-code-review-sol.md:1).

Key outcomes:

- Corrected false measurement, footer-label, navigation, and page-inventory claims.
- Completed the constant rename sweep; only the intended historical mention remains.
- Removed remaining stale footer counts.
- Made the plan body agree with all five accepted first-review changes.
- Confirmed the shelf self-drop is inert in the current app tree.
- Confirmed no current navigation label says “Public shelf”.
- Mutation-tested Pricing’s `here`: the new test failed correctly when it was changed.
- Kept the constant-built `SHELF` expectation; its rationale is sound.
- No wider decision or further scope cut is needed.

Verification:

- Typecheck: passed, four projects and 2,188 files covered.
- Scoped unit tests: 7 files, 158 tests passed.
- Final footer/doc-link rerun: 32 tests passed.
- Touched-file lint: clean, apart from one pre-existing informational complexity warning.
- Full `npm test`: attempted, but global setup could not access Postgres or Docker under the sandbox, so no full-suite assertions ran.