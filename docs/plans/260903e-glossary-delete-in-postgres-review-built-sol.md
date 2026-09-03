## Verdict: do not ship

The delete implementation itself looks sound. I found no functional race or transaction bug. But the diff still contains false replacement comments—the exact failure you asked me to prevent—and the critical 409 predicate lacks one decisive test.

### Findings

1. **[Reasoned] The live-running branch of the 409 predicate is untested.**

   [store-glossary-delete-pg.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/tests/store-glossary-delete-pg.test.ts:435) tests:

   - queued + draft → 409
   - expired running + draft → allowed
   - live running + no draft → allowed

   It never tests **live running + draft → 409**. Delete the entire `running` arm from `liveJobHoldingADraftQuery` and all three cases still pass. Add that positive case, including confirmation that the glossary remains present.

2. **[Reasoned] The replacement schema comment is still false.**

   [schema.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/db/schema.ts:390) says “Every step mints a revision.” A multi-step job opens one draft, all its steps write into that draft, and the job publishes it once. Individual steps do not each mint revisions.

   Lines 399–400 are also wrong: a published revision’s `status` does not “move after publication,” and `articles.current_revision_id` is not bookkeeping on the revision row. Say instead:

   > Every pipeline job writes its steps into one draft revision and publishes that draft on a `done` ending. Publication changes the draft’s status and moves `articles.current_revision_id` atomically. After publication, the glossary delete below is the deliberate in-place exception.

   [pg-revisions.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/store/pg-revisions.ts:660) repeats the same overstatement as “every step drafts and publishes now”; that should say every pipeline job uses the draft/publication path.

3. **[Reasoned] One stale “Postgres is missing” comment was missed entirely.**

   [store-seams-have-two-implementations.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/tests/store-seams-have-two-implementations.test.ts:235) still says `GlossaryStore` lacks a Postgres side and `fsGlossaryStore` is the only `Pick`-declared adapter. Both claims are now false. Update the comment and make this particular `Pick` parsing check expect both `fsGlossaryStore` and `pgGlossaryStore`.

4. **[Reasoned, unrelated to the glossary verdict] The postmortem’s root cause is right, but its first fix does not close the whole class.**

   The proposed `useStepJob` disappearance reconciliation covers the eight mode hooks, but not `Library`/Add, which consume completion through `useJobs`. Yet the postmortem explicitly lists Add as affected.

   Therefore [the claim that this closes “the whole class”](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/docs/postmortems/260903e-successes-deleted-before-failures-so-no-job-is-ever-announced-done.md:105) is too strong. Either:

   - rank the server-side success floor first, because it protects every consumer; or
   - move vanished-active-job handling into the shared job engine, retaining enough last-seen job information to notify all consumers.

   The title should also qualify that this happens once an owner’s retained history is saturated by failures.

### The requested attacks

- **409 predicate:** Correct rows and semantics. The join follows `jobs.draft_revision_id`, requires that revision to belong to the article and remain `draft`, and admits exactly queued jobs or running jobs with a non-null attempt and `lease_expires_at > clock_timestamp()`. Expired jobs cannot subsequently publish because the same lease predicate fences publication.

- **Concurrency/locking:** Sound. Draft opening and session commits take the article lock before changing publishability. The delete locks that same article row before inspecting jobs, so it either sees the committed draft pointer or runs before the draft copies the glossary.

- **Integration test:** It exercises the real claim, coordinator, Postgres session, artefact commit, and publication. It actually replaces the whole glossary step descriptor and deliberately removes `stamp`, not merely `run`; that does not hollow it out. Removing freshness makes the test stricter about the intended presence transition: a broken `hasArtefacts === true` after deletion cannot be rescued by a stale stamp.

- **`rowCount === 1`:** Correct. This is the installed node-postgres driver; Drizzle returns its raw `QueryResult` for an update without `returning()`, and node-postgres obtains `rowCount` from the `UPDATE n` command tag. The predicate names one primary key, so only 0 or 1 is legitimate. `>= 1` would weaken the invariant.

- **Transaction scope:** Minimal and correct. Validation is outside; ownership lookup, article lock, job check, and conditional update are inside. The lock is held only through the update and commit.

- **409 propagation:** Correct. `guardDbStore` passes any numeric-status error unchanged; the route uses that status and sends `err.message`; `fetchOk` reconstructs it from the JSON `error`; `useGlossary` displays it. The wording is long but understandable and actionable.

- **`currentRevisionId === null`:** `{ deleted: false }` is right. The owned article exists and already has no published glossary; that is idempotent success, not 404.

- **Other requested comments:** The `pg.ts` and `useGlossary.ts` replacements are true. The substantive lock/copy explanation in `pg-revisions.ts` is also true apart from “every step drafts and publishes.”

### Checks run

- Directly rendered the lock query: it contains owner filtering and `FOR UPDATE`.
- 35/35 pure guard/client tests passed.
- 26 passed and 14 database cases skipped in the seam/ownership/isolation run.
- Typecheck passed for all projects.
- Cycle check passed.
- Scoped lint found only existing `pg.ts` complexity/optional-chain diagnostics outside these edits.

I could not execute the database-backed assertions: this sandbox denied the local Postgres socket with `EPERM 127.0.0.1:54362`, so the four requested suites reported 28 skipped rather than passing. I am not counting those skips as evidence.