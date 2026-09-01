# Verdict: NO-SHIP

The pipeline path is much better, and the previous lineage blocker is fixed there. But two shipping blockers remain, including one path that can still bury a newer publication.

## Findings

1. **Critical — standalone `publishRevision` bypasses exact-base verification.**

   [`publishRevision`](/home/greg/code/spideryarn2/src/store/pg-revisions.ts:1332) calls [`publishRevisionIn`](/home/greg/code/spideryarn2/src/store/pg-revisions.ts:1373), which validates and moves `articles.current_revision_id` but never reads `based_on_revision_id`.

   Only the pipeline session performs the comparison, after `publishRevisionIn` returns, at [`pg-session.ts:485`](/home/greg/code/spideryarn2/src/store/pg-session.ts:485).

   Concrete failure:

   1. Draft D copies R1 and records `based_on_revision_id = R1`.
   2. R2 publishes.
   3. Someone calls `publishRevision({ slug, revisionId: D })`.
   4. D publishes over R2. Nothing compares R1 with R2.

   Passing `job` only adds the live-attempt fence; it does not add the lineage check. Existing exact-base tests use standalone `publishRevision` to create R2, but do not test publishing the stale draft through that same function.

2. **High — session creation can fail after the job is claimed but before the recovery block exists.**

   The job becomes `running` at [`jobs.ts:1180`](/home/greg/code/spideryarn2/src/jobs.ts:1180). The Postgres session is then opened at [`jobs.ts:1274`](/home/greg/code/spideryarn2/src/jobs.ts:1274), while the encompassing `try` starts only at [`jobs.ts:1327`](/home/greg/code/spideryarn2/src/jobs.ts:1327).

   A connection failure or other error from `openOrBeginJobDraft` therefore:

   - escapes the request;
   - leaves the job `running` with its attempt and global slot;
   - is not terminalised until a later advance notices the expired lease;
   - appears as a generic interruption rather than the real failure.

   This is the same externally visible hang the new all-skipped catch was designed to eliminate, reached one transaction earlier. The old decorator could not fail during session construction, so the flip introduced this opening.

3. **Medium — the wide catch wrongly turns permanent database failures into retryable ones.**

   The catch width at [`jobs.ts:1548`](/home/greg/code/spideryarn2/src/jobs.ts:1548) is right: terminalising an unexpected publication failure is better than leaving the job running. But [`jobs.ts:1578`](/home/greg/code/spideryarn2/src/jobs.ts:1578) labels every non-`PublishRefused` error `"retry"`.

   That overwrites the distinction already made by the database boundary:

   - transient `STORAGE_BUSY` is `"retry"`;
   - permanent `STORAGE_FAILED` is `"bug"` and explicitly says retrying will not help at [`messages.ts:795`](/home/greg/code/spideryarn2/src/messages.ts:795).

   Input: every step skips, publication hits SQLSTATE `23514` or another permanent constraint failure. The job is persisted as retryable with “Trying again is safe,” and both the UI and retry endpoint offer another run.

4. **The empty-scratch assertion is useful, but its stated scope is false.**

   [`assertScratchUntouched`](/home/greg/code/spideryarn2/tests/claim-session-postgres.test.ts:207) genuinely distinguishes the new session from the restored decorator: the decorator writes the fake products through the filesystem store. Its red mutation is meaningful.

   It does not prove a real Postgres ingest writes nothing to scratch. The test substitutes fake step bodies. Real steps still intentionally write checkpoints:

   - hierarchy passes `ctx.dir` as its checkpoint directory at [`pipeline.ts:1741`](/home/greg/code/spideryarn2/src/pipeline.ts:1741), and [`hierarchy.ts:1585`](/home/greg/code/spideryarn2/src/hierarchy.ts:1585) creates it;
   - PDF extraction creates `pdf-chunks` at [`pdf-read.ts:1064`](/home/greg/code/spideryarn2/src/pdf-read.ts:1064).

   It also would not catch a real stage regressing to dual-writing its artefact to disk while still returning correct `parts`. A deterministic real-stage case through `claimSession`, allowing only documented checkpoint paths, would catch that.

5. **Several current signposts are now false.**

   Most importantly, [`database.md:202`](/home/greg/code/spideryarn2/docs/project/database.md:202) still says every pipeline stage writes to disk and the result is copied into Postgres.

   [`store/revisions.ts:24`](/home/greg/code/spideryarn2/src/store/revisions.ts:24) still describes the revision lifecycle as unwired, and its dormant `publish` method is one caller of the unguarded standalone publication path. [`pipeline.ts:455`](/home/greg/code/spideryarn2/src/pipeline.ts:455) still says eleven steps, while another comment claims four remain unconverted despite the exemption list being empty.

## Answers to the specific questions

1. **Lineage is exact on the `pgStoreSession` path, but not globally.** Mint, reopen, first-revision `null`, legacy drafts, and concurrent session publications behave correctly. `db:export` only reads the current published revision. Standalone `publishRevision` remains a bypass.

2. **`REVISION_CARRY_POLICY` is correct.** `basedOnRevisionId` is `"mint"`; `carriedColumns()` excludes every `"mint"` field before constructing `columnList`; `beginDraftIn` writes the actual `basedOn` separately. It cannot be inherited through that mechanism.

3. **The catch is not too wide; its classification is wrong.** Cancellation is represented in job state, not thrown through this publication call. Fatal process OOM is not meaningfully recoverable by this catch. Ordinary bugs should be reported and the job terminalised, but as `"bug"`, not rewritten as `"retry"`. If the second `endJob` fails, its error replaces the first at the caller boundary, although the original was already captured and logged. Mutating `job` is safe because both stores return detached job objects.

4. **The retry refusal itself is correct.** `old.status` comes from the selected store; there is no separate authoritative live map in Postgres, and the filesystem adapter returns clones of its in-memory record. The 409 wording contains no article or ownership information, and ownership is checked first. General `POST /api/jobs` still accepts explicit `force`, but that is the refresh/late-step API, not a retry bypass.

5. **The flip covers the decorator’s actual production duties.** Both completion doors publish transactionally through `pgStoreSession`. `copyArtefacts` now has only fixture-loading use, and the old zero-copy refusal is obsolete on the production ingest path. The remaining problem is that the base guard was not moved into the underlying publication primitive.

6. **The scratch assertion is load-bearing but narrower than advertised.** It proves the session selection and lack of filesystem artefact commits for the fake steps. It does not prove that real stages have no disk side effects.

7. **The handback change is right.** The article row and draft are how the next claim resumes committed work. Earlier database failure is also the right intent—do not run paid steps when storage is unavailable—but session-opening failure must be brought inside the claimed-job recovery lifecycle.

8. **No additional route or exporter breakage found.** The material overlooked behavior is the session-opening gap. The main collateral damage is stale documentation and comments.

## Shortest path to SHIP

1. Put the `based_on_revision_id` comparison inside `publishRevisionIn` itself, before moving the pointer. Add a red test that publishes a stale draft through standalone `publishRevision`.
2. Cover session construction with claimed-job recovery. The recovery must transactionally fail/clear any draft already owned by that attempt and terminalise the job; a plain `store.finish` is insufficient because it can leave `draft_revision_id` behind.
3. Preserve `failureKindOf(err)` in the all-skipped catch and remove the unconditional promise that retrying is safe. Test both `STORAGE_BUSY` and `STORAGE_FAILED`.
4. Correct the empty-scratch claim and the now-false database/revision/pipeline signposts.

I did not run executable checks: the relevant suites write to Postgres, which the review forbids, and the repository’s `npm run typecheck` script deliberately walks the top-level `data/` tree, which was also prohibited. No files or database state were changed.