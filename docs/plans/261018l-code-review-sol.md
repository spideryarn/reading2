No blocking defects found. The public DTO exposes only `{ from, to, kinds }`, fails toward absence, preserves owner/visitor parity, and the public import graph remains gateway-free.

- P3 — stale ownership and moved-symbol comments at [schema.ts:1180](/var/tmp/spideryarn-worktrees/qi-8y3tx5tp-public-matter-folds/src/db/schema.ts:1180), [pg.ts:1031](/var/tmp/spideryarn-worktrees/qi-8y3tx5tp-public-matter-folds/src/store/pg.ts:1031), [pg-revisions.ts:403](/var/tmp/spideryarn-worktrees/qi-8y3tx5tp-public-matter-folds/src/store/pg-revisions.ts:403), [types.ts:6864](/var/tmp/spideryarn-worktrees/qi-8y3tx5tp-public-matter-folds/src/types.ts:6864), [matter-step.ts:16](/var/tmp/spideryarn-worktrees/qi-8y3tx5tp-public-matter-folds/src/matter-step.ts:16), and [pipeline-artifact-store.test.ts:434](/var/tmp/spideryarn-worktrees/qi-8y3tx5tp-public-matter-folds/tests/pipeline-artifact-store.test.ts:434). Changed them to describe both reads, the DTO boundary, and `matter-current.ts`. Also removed the trailing blank line reported by `git diff --check`.

Verification:

- Typecheck passed for all projects.
- Scoped unit tests: 7 files, 285 tests passed.
- Targeted lint and `git diff --check` passed.
- The Postgres integration test could not run because the sandbox denied access to `127.0.0.1:54362`; no test assertion failed.
- No commit made.

VERDICT: ship