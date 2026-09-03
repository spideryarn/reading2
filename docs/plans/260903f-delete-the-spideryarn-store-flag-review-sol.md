## Verdict: not ready

The direction is right, but the plan would currently delete meaningful coverage too early, understates both C′ prerequisites, and makes D larger and riskier than necessary. I would restage it before building.

### 1. Staging

The main correction is to separate three kinds of filesystem-backed tests:

- Filesystem-adapter behaviour tests: retain these until the corresponding adapter is deleted in E–H.
- Store-agnostic unit tests using filesystem as a cheap fake: move these to narrow `ArtifactReads` or purpose-built fakes.
- Genuine database integration tests: move these to Postgres.

Stage B′ currently treats these as one category. For example, [pipeline-artifact-store.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/pipeline-artifact-store.test.ts:481), [artefact-copy.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/artefact-copy.test.ts:136), and `store-session.test.ts` test the filesystem implementation itself. Deleting them before deleting their subject creates an uncovered interval indistinguishable from success.

The test inventory also needs to become an explicit file manifest:

- The broad mechanical scan finds 42 ungated test files importing `store/index`, `routes`, or `api`, not an auditable 29.
- There are 42 test files directly importing condemned filesystem modules or symbols.
- Their union is about 80 candidate files. Some need no edit, but the plan must record why each excluded file is safe.

The missing major stage is the six standalone stage CLIs. They still write filesystem artefacts. Their database migration—or an explicit decision to retire them—must precede deletion of the artefact filesystem machinery.

### 2. Stage D

D should be narrower. Only the atomic policy change needs to be there:

- Remove store selection and runtime feature gates.
- Make application/dev/health paths unconditionally require Postgres.
- Flip test readiness from optional skipping to required preflight.
- Introduce the obsolete-value tombstone.
- Remove active environment injection.

Several proposed riders should move outside D:

- **Self-guarding exports:** do this additively before D. Double wrapping is already harmless. There are **15**, not 13, index-selected Postgres seams relying on the central guard.
- **Glossary deletion:** implement it before D. The supposed open product decision is stale; [live.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/src/store/live.ts:183) records that nulling glossary should trigger the ordinary rebuild without deleting the step run.
- **Required `attempt` types:** tighten these with or after removal of the corresponding filesystem implementations. Chat needs special treatment: `appendSpoken` legitimately returns no attempt, so `Turn.attempt: string` would be wrong without splitting the return type.
- **Readiness infrastructure:** build and test it before the hinge; D should only activate it.

D also omits [vite.config.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/vite.config.ts:55), which has another `SPIDERYARN_STORE` conditional. The true count is 18 comparisons across nine `src` files, or 19 across ten files when Vite is included.

### 3. C′ prerequisites

Both prerequisites are real, but both are harder than described.

The cost ledger redirect cannot safely become “Postgres plus cleanup.” Routes use a global cost store and independent pooled connections, while Vitest runs files concurrently. A surrounding test transaction will not contain those writes unless the cost store becomes executor/transaction-aware.

The acceptance test should prove:

- `pgCostStore.record` genuinely executed.
- Fixture costs were never visible to normal dev reports.
- A crashed or failed suite rolls back.
- Parallel test files remain isolated.
- Direct ledger integration tests still exercise committed behaviour.

That deserves its own reviewed stage.

The fixture seeder is also two different tools:

- A minimal direct-row helper for tests needing only an article record.
- A corpus loader for `db:seed-dev` and rich route tests.

[load-article.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/helpers/load-article.ts:13) does much more than insert a readable article: it loads raw bytes, creates a job and draft, copies available fixture stages through the real writer, runs publication guards, and publishes. Replacing that with a “minimum coherent direct insert” would silently remove integration coverage. [scratch-article.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/helpers/scratch-article.ts:30) already explains why a second files-to-Postgres implementation is undesirable.

Also, the proposed consolidation is larger than stated: **28** test files directly call `.insert(articles)`, not approximately 20.

### 4. Negative control

Stopping or misdirecting Postgres and seeing one expected error is necessary but insufficient. It can pass while 80 suites still register `describe.skip`.

The final proof should combine:

- A global pre-collection database check that fails the command once.
- No `reachable ? describe : describe.skip` pattern remaining.
- A static test or inventory assertion enforcing that absence.
- A positive run demonstrating that the named database suites were collected and executed with no database-related skips.
- Per-suite mutation evidence retained from B.

The existing helper deliberately registers a failing test and then skips its suite under required mode; see [pg-ready.ts](/home/greg/code/spideryarn2/.claude/worktrees/delete-store-flag/tests/helpers/pg-ready.ts:84). That is not the desired end state.

Also, setting a bad shell `DATABASE_URL` may not misdirect the application because `.env.local` overrides inherited values. Stopping the shared Supabase would disrupt other agents. Provide an injectable preflight target or isolated subprocess and assert that the diagnostic names the deliberately bad target.

### 5. Other silent-success risks

- Port or enumerate every surviving assertion before deleting a filesystem suite; compiler success cannot detect deleted coverage.
- `data-root.ts` also serves evals, export and setup/worktree scripts. Its deletion requires relocating those generic responsibilities.
- Test job teardown is not demonstrably “eight files”; the scan finds 11 files referring to job directories or helpers. Use a named inventory and replace cleanup with a database postcondition querying for leaked test identifiers.
- Update behavioural docs alongside the stages they describe. Deferring every doc change until J leaves instructions wrong during the migration.
- Add a post-deployment stage to remove the tombstone after Preview/Production variables are gone. Otherwise the plan simultaneously says “keep it for about a week” and declares completion only when the identifier no longer exists.
- The final grep must include `vite.config.ts`, `evals/`, scripts and `AGENTS.md`, not only the currently listed paths.

### 6. Factual corrections

- `createFsArtifactStore`: currently 14 test files plus `tests/helpers/load-article.ts`. It becomes 13 test files only if `stage2c-raw-bytes.test.ts` is deleted first.
- Index-selected Postgres seams lacking their own guard: **15**, not 13.
- `src/store/fs.ts`: **576 lines**, not 574.
- Store-related parity suites: eight appears correct.
- `pgReady`: 83 test files mention it; the plan’s 80–83 estimate is sound.
- Exact project docs naming the flag: 15 appears correct.
- Several listed source line numbers have drifted, including jobs and pipeline.
- “The filesystem store is kept alive only by tests and two fixture paths” is false for the repository as a whole because the standalone stage CLIs still depend on it.

A safer sequence is:

`inventory/B → test classification → ledger isolation → fixture/corpus loader → additive export guards → narrow D hinge → CLI migration → adapter deletion with matching tests → operational docs/deployment → tombstone retirement and final global grep`.

No tests were run; this was a source and inventory audit. No files were changed.