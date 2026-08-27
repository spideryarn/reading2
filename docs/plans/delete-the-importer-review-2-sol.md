# NO-SHIP

C1 is not safe alone, C7 cannot work with the helper as built, and normal draft cleanup is still undefined.

## Ranked findings

1. **CRITICAL — C1 can rerun `toc` without invalidating its consumers. Confidence: high.**

   `cascadeForce` is computed only from explicit force flags when the job is created (`src/jobs.ts:178-189`, `src/jobs.ts:919-924`). C1 adds a new reason for `toc` to run during `stepIsDone`, but that does not add force to later steps.

   Reproduction:

   1. Keep an existing `arc.json`.
   2. Make stage-3 blocks differ from stage-4 `blocks.json`, or use a legacy `labels.json` with no `sourceHash`.
   3. Run an unforced job containing `toc` and `arc`.
   4. `toc` runs because its stamp is stale; `arc` still answers done by presence and skips because it has no stamp (`src/pipeline.ts:497-509`, `src/pipeline.ts:1101-1129`).

   That leaves a new tree beside an old arc. `tweets`, `glossary`, and `summary` also read the tree but currently use blocks-only freshness. A `toc`-only job is worse: consumers absent from the job cannot even be dynamically forced.

   This needs a dependency-invalidating rule before C1: rerunning `toc` must either invalidate dependent outputs/run rows or make every consumer prove currency against the tree.

2. **CRITICAL — C7 cannot use `copyArtefacts` with the proposed Postgres adapter protocol. Confidence: high.**

   `copyArtefacts` calls only `write` (`tests/helpers/artefacts.ts:87-91`). It never calls `beginStep` or `finishStep`. But C4 defines Postgres `has` as requiring a done run row, and C2 makes completion exclusively the fenced `finishStep` transition (`docs/plans/delete-the-importer.md:401-425`).

   Therefore copying produces values that Postgres considers incomplete, and publication lacks a completed `toc` row. Making `write` secretly mark the step done would contradict C2 and the capability split.

   The missing fixture coordinator cannot be deferred to D, because the plan explicitly excludes that coordinator from C while expecting C7 green (`docs/plans/delete-the-importer.md:441-447`).

3. **CRITICAL — B2 is not “mostly built”: `RawManifest` cannot populate `raw_sources` truthfully. Confidence: high.**

   `RawManifest.bytes` is the network payload length (`src/fetch.ts:123-133`, `src/fetch.ts:196`). For HTML, the stored object is instead the UTF-8 encoding of decoded text (`src/fetch.ts:159-168`). Those lengths can differ.

   But `raw_sources.bytes` describes the object at the stored hash (`src/db/schema.ts:1048-1063`). C6 cannot derive that value from the proposed product. The product needs a stored-byte length, or an object-registration result carrying it.

   There is a second provenance hole: `uploadId` is not durably “already on jobs.” Publication clears the job’s draft link (`src/store/pg-revisions.ts:968-976`), revisions carry no job id, and finished jobs can be deleted (`src/store/pg-jobs.ts:414-444`). The adapter cannot reconstruct an uploaded `RawManifest.uploadId` later. Either add revision-level storage or explicitly drop that provenance promise.

4. **CRITICAL — opening the draft before the skip check leaks ordinary drafts. Confidence: high.**

   A bound Postgres preflight store requires `openOrBeginJobDraft` before `stepIsDone`. For an existing current article:

   1. `openOrBeginJobDraft` mints and records a copied draft.
   2. Every requested step proves current and skips.
   3. `pgJobStore.finish` marks the job done but does not clear `draft_revision_id` (`src/store/pg-jobs.ts:289-326`).
   4. `sweepAbandonedDrafts` spares drafts referenced by any job, including terminal jobs (`src/store/pg-revisions.ts:1081-1098`).

   The same leak occurs when a stage errors or `failExpired` ends the job; neither transition clears the draft (`src/store/pg-jobs.ts:329-355`).

   D needs an explicit all-skipped, failed, cancelled, and expired-draft transition. Alternatively, preflight must read the current revision without minting until a step actually needs to run.

5. **HIGH — the C4 reproduction contradicts both the code and the stated `has` definition. Confidence: high.**

   `beginDraftIn` carries both block rows and step-run rows (`src/store/pg-revisions.ts:584-611`). Carrying a published revision therefore normally produces blocks plus a done `toc` row. Under C4’s definition, `has("toc", ["blocks"])` must return true; only C1’s stamp comparison makes `stepIsDone` false.

   The previous review also required internal consistency between the stored `toc.input_hash` and collapsed block rows. The revised plan dropped that requirement while retaining a test that expects its result.

   Choose one:

   - Presence/completion only: expect `has === true`, `stepIsDone === false`.
   - Complete-generation consistency: restore the internal hash rule and say plainly that `has` contains a `toc` special case.

6. **HIGH — C2’s proposed red test stays green after removing the attempt fence. Confidence: high.**

   The test starts from “a step-run that has ended” (`docs/plans/delete-the-importer.md:408-410`). Such a row is already not `status = 'running'`. Delete `attempt_id = ?`, and the remaining status predicate still refuses it.

   Use two independent cases:

   - `status = running`, token A; finishing with token B tests the attempt fence.
   - `status = done/error`, token A; finishing with token A tests the status fence.

   This directly contradicts lesson 1’s claim that the proposed mutation habit catches the fault.

7. **HIGH — importer-written rows are useful smoke data, not a sound C3 oracle. Confidence: high.**

   Known importer losses and inventions prevent full parity:

   - It deliberately stores `extractedHtml: null` (`src/store/import.ts:545-547`), while the filesystem adapter reads the post-stage-3 HTML as both logical HTML kinds.
   - It stamps every inferred step with the same blocks fingerprint (`src/store/import.ts:800-837`), while `ideas` records a blocks-plus-tree fingerprint (`src/pipeline.ts:1338-1346`).
   - It loses uploaded filename/upload identity before C6.
   - It has no stored-source reference.

   Comparing adapter output to independent filesystem expectations may expose these discrepancies, but it proves importer-plus-adapter behaviour, not adapter correctness. C3 needs explicit mapping fixtures; importer rows can remain separate legacy compatibility cases.

8. **HIGH — `copyArtefacts` omits facts on which the replacement suites rely. Confidence: high.**

   Beyond step completion, it does not preserve:

   - Raw payload bytes. `store-roundtrip` explicitly compares filename and bytes (`tests/store-roundtrip.test.ts:292-307`).
   - Comments, chat, searches, lookups, and shelf state. Both roundtrip and library parity inspect these.
   - Historical `createdAt`. Library parity relies on the blocks-file mtime when `fetchedAt` is absent (`tests/store-parity.test.ts:364-380`); a production draft minted today changes that result.
   - True `extractedHtml`: it copies the stage-3-overwritten file into the stage-2 column, while the importer honestly records that original as lost.

   The reader-state omission is deliberate and repairable through live stores, but C7 must specify that setup. The timestamp and raw-payload cases require additional fixture design.

   Additionally, every checked-in `raw.json` currently lacks `storedSha256`. Thus C6’s required refusal makes C7 fail immediately:

   ```sh
   for f in data/*/raw.json; do
     rg -q '"storedSha256"' "$f" || echo "$f"
   done
   ```

   This prints all seven current manifests.

9. **MEDIUM — C1 changes the metadata page and one current fixture immediately. Confidence: high.**

   The filesystem metadata page calls `stepIsDone` (`src/api.ts:644-655`), despite its documentation saying it does not answer staleness (`src/api.ts:572-588`). C1 makes its `toc` tick a freshness verdict.

   Current evidence:

   - All stage-3/stage-4 block pairs have identical semantic `hashBlocks` values.
   - `data/constitution/labels.json` lacks `sourceHash`, so its currently complete `toc` becomes not-done under C1 and will buy a new ToC call when requested.
   - Postgres metadata is unaffected by C1 until the adapter lands; it never compares database blocks with files on disk.

   The stamp itself is sound, but C1 must include the metadata contract update and the downstream invalidation fix from finding 1.

10. **LOW — several lessons overgeneralize the evidence. Confidence: high.**

   Cut or rewrite lesson 3. One uncalled method failing does not support “the method with no caller is the one that does not work.” The useful rule is: *an unexercised path is unproven*.

   Narrow lesson 1 to the dimension shared by the check and implementation; shared assumptions do not make every assertion worthless. C2’s blind mutation is the counterexample.

   Narrow lesson 5 to ambiguous ORM behaviour. “Reading code is not evidence” is too strong; the measured result was valuable because `set: values` semantics were in doubt.

## Empty-block outcome

Delete-all itself is correct:

- `revision_blocks` becomes empty.
- `block_identities` remains permanently.
- Comments and chat remain because they anchor to article-level identities, not revision rows.
- `articles.current_revision_id` remains on the previous published revision, or null for a first ingest.
- If the draft is failed and detached, the sweeper eventually removes its revision and step rows while retaining identities.

The unhandled case is abandonment without detaching the job: the job pointer makes the sweeper spare that empty draft indefinitely.

## C6 migration risk

`raw_filename` itself does not interact with the existing composite CHECK or FK; as a nullable revision column, the expected DDL is only `ADD COLUMN`. The necessary companion change is classifying it as `carry` in `REVISION_COLUMN_POLICY`; existing exhaustive tests should force that decision.

The dangerous part of C6 is the insufficient raw product and provenance model, not the column migration.