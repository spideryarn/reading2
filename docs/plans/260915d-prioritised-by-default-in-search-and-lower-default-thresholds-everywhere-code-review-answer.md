Review complete; verdict is **approve after fixes**. No behavioral defects were found in the constants, parser default, quote-stroke decoupling, or glossary fixture.

I fixed four documentation/evidence issues, recorded in [the code review](/home/greg/code/spideryarn2/.claude/worktrees/fb-prioritised-defaults/docs/plans/260915d-prioritised-by-default-in-search-and-lower-default-thresholds-everywhere-code-review-sol.md).

Verification:

- Relevant Vitest: 15 files, 486 tests passed
- Doc links: 14 tests passed
- Scoped Biome lint: clean
- Typecheck: all projects passed via the equivalent Node/tsx-loader invocation; the normal command was sandbox-blocked opening an IPC socket
- `git diff --check`: clean
- Full suite not run, as requested
- No commit, push, or git-state mutation

The unrelated untracked feedback note was left untouched.