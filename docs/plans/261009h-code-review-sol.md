F1 — should — **FIXED.** Retry reused the assistant row but did not clear `editedAt`, despite `finish` accepting it. Added the reset and assertion in [pg-chat.ts](/var/tmp/spideryarn-worktrees/bug-hp-chat-cutoff/src/store/pg-chat.ts:614) and [chat-truncated-stored.test.ts](/var/tmp/spideryarn-worktrees/bug-hp-chat-cutoff/tests/chat-truncated-stored.test.ts:173).

F2 — should — **FIXED.** The ceiling override tests exercised the test/eval-only explicit `model` seam, not production’s environment overrides. They now use `SPIDERYARN_CHAT_MODEL` and `SPIDERYARN_EXPLAIN_MODEL` in [converse-ceiling.test.ts](/var/tmp/spideryarn-worktrees/bug-hp-chat-cutoff/tests/converse-ceiling.test.ts:116).

F3 — should — **FIXED.** Rollback/export and restore coverage did not directly assert `truncated`; the restore test also did not guard `passages` or `interrupted`. Added coverage in [store-export-bundle.test.ts](/var/tmp/spideryarn-worktrees/bug-hp-chat-cutoff/tests/store-export-bundle.test.ts:699) and [helpers-seed-reader-state.test.ts](/var/tmp/spideryarn-worktrees/bug-hp-chat-cutoff/tests/helpers-seed-reader-state.test.ts:240).

F4 — nit — **FIXED.** Comments and project docs still described the rollback as dropping fields it now preserves, and stated the old ceilings as current. Corrected the source comments and [chat-tools.md](/var/tmp/spideryarn-worktrees/bug-hp-chat-cutoff/docs/project/chat-tools.md:865) / [high-powered-ai.md](/var/tmp/spideryarn-worktrees/bug-hp-chat-cutoff/docs/project/high-powered-ai.md:141).

F5 — should — **LEFT, wider scope.** Explain and Dig deeper still store a `length` ending as a normal completed `Comment`; solving that requires a Comment column, store/export wiring and UI copy. The plan correctly identifies this follow-up.

F6 — should — **LEFT, wider scope.** Confirmed the plan’s `Meta.quality` sibling: it exists in `Meta` and is read by feedback, but has no database column or mapper. This belongs to the pipeline artefact store, outside the chat change.

Checks:

- 54 unit/doc tests passed, including the four non-database requested suites.
- Migration chain passed; migration snapshot/journal suites passed, 53 tests.
- Full typecheck passed via `node --import tsx scripts/typecheck.ts` over 3,568 files. The normal npm wrapper was attempted but sandbox-blocked from opening its local IPC socket.
- The exact combined suite could not collect `chat-route` or `chat-truncated-stored`: sandbox-denied Docker access prevented private-Postgres setup. No tests were skipped as green.
- Lint: no errors; one existing complexity advisory.
- No commit, push, deploy, environment-file edit, or remote database access.

APPROVE WITH CHANGES MADE