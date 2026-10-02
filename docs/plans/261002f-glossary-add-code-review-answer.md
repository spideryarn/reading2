Review complete. Findings and verdict are in [261002f-glossary-add-code-review-sol.md](/home/greg/code/spideryarn2/.claude/worktrees/fbj5bsp7-glossary-add-looked-up-term/docs/plans/261002f-glossary-add-code-review-sol.md).

Found and fixed:

- Medium: rollback restoration dropped `addedName`, making restored added terms disappear.
- Low: missing edge-case coverage for collisions, absorbed hides, refresh races, malformed results, Dig deeper, and Chat privacy.
- Low: stale comments and a test still described the old “not added” behavior.

Verification:

- Typecheck passed via direct script invocation.
- 57 focused unit tests passed.
- 20 additional Stop-card/chat tests passed.
- Scoped lint and `git diff --check` passed.
- Database-backed tests could not run because the sandbox rejects connections to `127.0.0.1:54362`; the report marks this explicitly.

Verdict: approve with fixes, conditional on rerunning the focused Postgres tests outside this socket-restricted sandbox.