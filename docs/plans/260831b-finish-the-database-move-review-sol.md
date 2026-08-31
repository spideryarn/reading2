NO-SHIP. Stage 1 is not coherent without durable writes, and Stage 5 removes deployment safeguards that protect executable compatibility rather than corpus data.

## Critical findings

1. Stage 1 cannot safely read Postgres while writing files.

`session.reads` is used both for preflight and during the run ([jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:483), [jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:539)). If it becomes a published-revision reader:

- A fresh ingest writes `toc` to scratch, then `assets` asks `session.reads` for those blocks ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1543)). Postgres has no published revision yet, so the ordinary default pipeline fails.
- If scratch is layered in front, the previous NO-SHIP returns: scratch is job-scoped, not attempt-scoped.
- On handback, `publishingSession` persists nothing: non-terminal commits delegate to the filesystem session; only a `done` ending calls `publishAndFinish` ([publish-session.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/publish-session.ts:318)). The next claim therefore cannot recover the previous claim’s output.
- On cancel-then-retry, the new job binds the last published revision, not the failed job’s files. A refresh that completed fetch/extract and failed later can retry against the old article.

The all-skipped distinction is consequently not solvable merely by changing the finalizer. “No work was needed” and “an earlier claim wrote work that this instance cannot see” remain indistinguishable.

Stage 1 is therefore not independently deployable as written.

2. `htmlCarriesItsIds` is fixed too late.

Stage 1 makes preflight read Postgres, so `htmlCarriesItsIds` immediately compares the published revision’s old blocks with its own old `stampedHtml` ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:611)). It returns true without looking at newly extracted HTML in scratch.

That is precisely the inversion the plan assigns to Stage 2. The guard must be replaced before any Postgres-backed preflight, not merely before the Stage-3 write flip.

3. Dropping `raw_bytes` still requires a compatibility release.

This protection was not about preserving the corpus. Current `beginDraftIn` still copies `rawBytes` through `REVISION_CARRY_POLICY` ([pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:168)). Deploy and migration are not atomic:

- Drop the column first: old or still-running application code fails.
- Deploy new code and then drop it: rolling back the application restores code that names a nonexistent column.

Stage 5 must not combine removal of all references with the column drop. Ship compatible code first; drop the column in a later migration.

4. The importer is deleted two stages too late.

Once Stage 3 publishes through `pgStoreSession`, the importer must be deleted or refuse referenced revisions in that same stage. The plan itself says this at lines 198–200, then leaves deletion until Stage 5.

After a job finishes, the active-job guard no longer protects it. The importer can update the published revision in place, writing `rawBytes` and related fields while leaving the reference columns untouched ([import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1004), [import.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/import.ts:1055)). “Data is expendable” does not make a revision whose metadata and referenced object describe different acquisitions correct.

## Earlier review findings not absorbed

- The exact-revision binding still lacks the second half of the earlier recommendation. `beginDraftIn` copies whichever revision is current when the lazy draft is opened ([pg-revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:585)). `publishAndFinish` checks article identity but not that the draft was based on the revision bound for reads ([publish-session.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/publish-session.ts:182)). Reads from R1 can therefore be overlaid onto a draft copied from R2. Current active-job constraints make the race uncommon, but the required invariant is still absent.
- `toc` remains path-based ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1445)). A cold retry that skips published earlier steps still opens scratch’s missing `blocks` file. Stage 1 names the six late stages plus blocks, so this earlier finding was omitted.
- Forced `extract` likewise still reads scratch’s raw manifest and payload ([pipeline.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1192)).
- Upload collision handling still asks Postgres whether the slug exists and then reads `raw.json` through `contextPaths` outside job scope ([jobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1939)). On deployment, `dataRoot()` deliberately throws without a job ([data-root.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/data-root.ts:158)).

## Factual corrections

Two of the three “looks finished but isn’t” premises are stale:

- The Postgres artefact write path is production-reachable now. `publishingSession` calls `copyArtefacts` with `pgArtifactsIn` ([publish-session.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/publish-session.ts:193)), and `copyArtefacts` calls destination `write` ([copy-artefacts.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/copy-artefacts.ts:125)). What remains unexercised is the direct `pgStoreSession` product-commit path. I cannot confirm from code alone whether a successful production job has actually traversed it.
- `db:export` already fails closed. It constructs `postgresBlobStore` before opening or writing anything ([db-export.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/db-export.ts:45), [export.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/export.ts:82)). That constructor requires both credentials and checks project identity ([blobs.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/blobs.ts:302)). There is no Stage-1 fix left here.
- Stage 4 does not have three missing Postgres methods. `pgAdminStore.listUsersAcrossOwners` exists ([pg-admin.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-admin.ts:302)); `pgVisibilityStore.set` exists ([pg-visibility.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-visibility.ts:93)). Their 501 implementations are intentionally the filesystem side. Only `deleteGlossary` lacks the Postgres implementation ([index.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/index.ts:261)).

A fourth “finished-looking” dead seam is `revisionLifecycle`: its own file says no production module imports it, and the only current reference is a guard test ([revisions.ts](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/revisions.ts:24)). Stage 5 should explicitly delete it rather than leave a second unused lifecycle beside `pgStoreSession`.

## Recommended staging

1. While filesystem reads remain live: fix all fingerprints; replace the blocks freshness guard; convert every path-based input, including `extract` and `toc`; fix the source route, upload collision, and `deleteGlossary`.
2. Move checkpoint callers and convert all ten stages to returned products, still using `fsStoreSession`.
3. Exercise the real coordinator through `openPgStoreSession`; add exact-base verification and the handback/warm/retry/all-skipped tests. Delete or hard-disable the importer, then flip to Postgres in the same stage.
4. Remove filesystem runtime adapters, switch local development and fixtures, and rewrite deploy checks. Remove all application references to `raw_bytes`, but retain the column.
5. After that release is known good, drop `raw_bytes`.

The value cannot honestly be front-loaded as the current Stage 1 promises: durable, generation-aware writes are the prerequisite for fixing the handback and retry faults rather than merely moving them.