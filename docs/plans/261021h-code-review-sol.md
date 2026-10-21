1. **P2 — [scripts/feedback-questions-publish.ts:208](/var/tmp/spideryarn-worktrees/published-questions/scripts/feedback-questions-publish.ts:208):** Concurrent insertion could make SQL refuse a write while the script reported success. **Fixed:** check `rowCount`, report refusal, exit 1.
2. **P2 — [scripts/feedback-questions-publish.ts:171](/var/tmp/spideryarn-worktrees/published-questions/scripts/feedback-questions-publish.ts:171):** Parse diagnostics could print pasted credentials. **Fixed:** withhold malformed file contents.
3. **P2 — [scripts/feedback-questions-publish.ts:251](/var/tmp/spideryarn-worktrees/published-questions/scripts/feedback-questions-publish.ts:251):** A lost COMMIT acknowledgement incorrectly claimed nothing was written. **Fixed:** report uncertainty and direct verification.
4. **P2 — [tests/feedback-questions-publish.test.ts:75](/var/tmp/spideryarn-worktrees/published-questions/tests/feedback-questions-publish.test.ts:75):** Connection mock returned an incompatible type, failing typecheck. **Fixed.**
5. **P3 — [src/feedback-question-values.ts:179](/var/tmp/spideryarn-worktrees/published-questions/src/feedback-question-values.ts:179):** Published rows accepted impossible dates. **Fixed:** share the file parser’s calendar validation.

Tests: **193 unit tests and 9 fake-client publisher tests passed.** New regressions failed before fixes. The requested four-suite command was blocked before collection by sandbox restrictions on Postgres/Docker; the database round trip remains unverified.

Typecheck: `npm run typecheck` was blocked by IPC permissions. The same script passed all projects via `node --import tsx scripts/typecheck.ts`.

No commits made.