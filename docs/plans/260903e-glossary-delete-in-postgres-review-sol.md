## Verdict — not ready

The basic delete is sound when the article is quiescent, but the plan misses a Postgres-specific race that can silently resurrect the deleted glossary. One load-bearing justification is also factually wrong.

## Findings

1. **Critical: any existing Postgres draft can undo the deletion. Address this before building.**

Every Postgres job opens a draft ([pg-session.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/store/pg-session.ts:211)), and that draft copies the current revision’s glossary and step rows ([pg-revisions.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/store/pg-revisions.ts:711)). The proposed delete changes the current revision in place without moving `articles.current_revision_id`.

Consequently, any draft minted before the delete—not merely a glossary job—can later publish its copied, non-null glossary. The exact-base guard accepts it because its `based_on_revision_id` still equals the unchanged current pointer ([pg-revisions.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/store/pg-revisions.ts:1561)).

A running glossary job is worse: the reset’s ordinary POST may be deduplicated onto that existing job ([jobs.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/jobs.ts:2440)), so no second clean run is created. With different work parameters it may queue, but then see the resurrected glossary and skip.

This is not simply the filesystem race. A filesystem job for another step does not copy and later rewrite `glossary.json`; every Postgres draft carries the glossary.

The simplest acceptable v1 is: while holding the article lock, refuse with 409 if a live queued/running job already has a draft for this article. Draft creation and publication use the same article-first lock order, so that check can be race-closed. Tell the reader to wait and press Start again once the job finishes. Add a deterministic test.

2. **Claim 1 is factually wrong: current glossary runs do not update published revisions.**

The schema comment says they do ([schema.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/db/schema.ts:390)), but current code does not. `writeArtefacts` requires a live job owning a `JobDraftRef` and updates that draft’s revision id ([artifacts-pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/store/artifacts-pg.ts:1272)). The finished job then publishes the draft.

So the immutability conclusion may still be right—the schema’s “immutable in its text” principle and `pg-revisions.ts` both anticipate deletion—but there is no live runtime precedent for mutating a published glossary. Rewrite the plan to call this a deliberate direct-write exception, and correct the stale schema comment in the same work.

3. **Claim 2 is correct only with no pre-existing draft, and the planned test does not prove the reader path.**

The local trace is sound:

- Null reads as `absent` ([artifacts-pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/store/artifacts-pg.ts:576)).
- `hasArtefacts` requires both `done` and every produced artefact ([artifacts-pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/store/artifacts-pg.ts:702)).
- `stepIsDone` stops immediately when `has` is false ([pipeline.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/pipeline.ts:927)).
- A new draft copies both the null column and the old `done` row; `beginStepRun` permits a new attempt to replace that row with `running`.

But directly asserting `hasArtefacts === false` is not enough for the claim that the reader’s `run(false)` actually executes and publishes. Add an integration test using the real Postgres claim/session path with a fake glossary step, asserting that an unforced job executes after deletion and publishes a replacement. No model call is needed.

4. **The lock choice is correct, but its load-bearing property is untested.**

The transaction and `SELECT … FOR UPDATE` are the right shape. They serialize against `publishRevision`, which also locks the article first. I see no lock-order inversion or deadlock; at worst the delete waits for a short database commit, not for the model call.

However, omitting `.for("update")` would leave the suite green unless a race happened accidentally. Copy `pgVisibilityStore`’s exported query-helper pattern and assert that the generated SQL contains `FOR UPDATE` ([pg-visibility.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/store/pg-visibility.ts:77)).

5. **The slug-guard plan is incomplete and currently invites the import cycle it warns about.**

`requireSlug` lives in `pg.ts` ([pg.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/src/store/pg.ts:138)), which the new file must not import. The plan specifies a local `notFound`, but not how `requireSlug` is obtained.

Specify either a small leaf extraction or a local guard using `isSlug`. Also add `pgGlossaryStore.deleteGlossary` to the family test in [store-slug-guard.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/tests/store-slug-guard.test.ts:73), or at minimum add the malformed-slug case to the new test.

6. **The documentation stage is incomplete.**

The current deployment doc still says deletion is correctly refused and the permission decision is open ([deployment.md](/home/greg/code/spideryarn2/.claude/worktrees/glossary-delete-pg/docs/project/deployment.md:926)). The plan also misses present-tense stale statements in `260827am-glossary-read-latency.md` and `260903a-improve-the-codebase-sweep.md`.

## The remaining specific answers

- **Leave `revision_step_runs` alone:** correct. `has` short-circuits before `stampFor`; the metadata page independently treats a null glossary as not current; carry-forward remains coherent. The importer was deleted on 2026-09-01, so it cannot be broken.
- **`{ deleted: boolean }`:** keep it. The conditional update is trivial and preserves filesystem parity even though today’s client ignores the body.
- **Ownership:** the proposed `ownedSlug` lookup is safe. The composite current-revision FK also prevents an article pointing at another article’s revision. The static test catches the exact unfiltered Drizzle spelling, while the planned other-owner behavioral case catches the actual security outcome.
- **File placement:** `pg-glossary.ts` is right. `pg-lookups.ts` owns the separate `GlossaryLookupStore` and `glossary_lookups` rows; deletion updates `article_revisions.glossary`.

I ran `tests/store-carry-forward.test.ts`; Vitest loaded it, but `pgReady` skipped all 9 tests, so I did not independently reproduce the plan’s recorded Postgres spike. The code trace supports its quiescent-state result, not the omitted concurrency case.