# NO-SHIP

The core non-raw adapter is close, but the raw round trip and verification claims are not true yet.

1. **`readBlocks` returning `null`: SHIP, with one test gap.**

   Given the current schema, zero rows cannot distinguish “the stage deliberately wrote zero blocks” from “the stage began and wrote nothing.” Treating both as absent is the safer answer. It makes [`assertProduced`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:555) fail, prevents `hashBlocks([])` becoming usable freshness evidence, and publication independently refuses zero blocks.

   The unconditional delete in [`writeBlocks`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:888) is still necessary so inherited rows cannot survive a failed empty result.

   The missing test is the complete outcome: begin → write empty → finish, then prove `read === null`, `has === false`, and publication refuses. The current delete test stops before finish.

2. **Meta/raw ownership split: SHIP.**

   Excluding `finalUrl`, `fetchedAt`, and `rawSha256` from [`META_COLUMNS`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:703) is right. They are stage-one facts, while [`extract.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/extract.ts:223) manufactures an extraction-time `fetchedAt`.

   A successful re-extraction without a new fetch gets the old values because all three are carried by [`REVISION_CARRY_POLICY`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-revisions.ts:167). A new article cannot successfully run extraction without raw input, so there is no successful path where extract must become their authority.

   Add a real `beginDraftIn` re-extraction test; the current test begins from a hand-built revision already holding those columns.

3. **`stampForStep` clashes: NO-SHIP.**

   Returning `null` is safe in `stepIsDone`: it causes a rerun. It is not safe everywhere.

   [`copyArtefacts`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/helpers/artefacts.ts:63) converts every `null` stamp to `{}`. Therefore:

   1. A Postgres row and artefact disagree.
   2. `stampForStep` returns `null`.
   3. The copy helper changes that to `{}`.
   4. The destination accepts the artefact and records no conflicting fields.
   5. The destination subsequently considers the artefact’s own stamp usable.

   That silently resolves the conflict in favour of the artefact—the outcome the clash rule was meant to forbid. It can also turn a metadata clash on a current glossary into an unintended append pass.

   Use a typed thrown error for a clash, distinct from ordinary “no stamp,” or make every caller explicitly refuse `null` when a stamped artefact is present. The row contributing only `implementationVersion` is implemented correctly.

4. **`writeArtefacts` ordering: transactionally safe, but move the step-run lock earlier.**

   Because every operation is inside the caller’s transaction, a late `StepRunNotHeld` rolls the artefact writes back. There is no committed corruption.

   Still, after the job fence and the pure `assertStampAgrees` checks, acquire the running step-row lock before touching artefact tables. Currently a call with no `beginStep` can replace thousands of block rows or insert a raw-source row before discovering the protocol error at [`recordStamp`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:1032). Earlier locking gives the advertised fail-fast behaviour and prevents earlier database errors from masking `StepRunNotHeld`.

   The current test only names the eventual error; it does not prove no work occurred.

5. **Two-statement `recordStamp`: SHIP.**

   `SELECT … FOR UPDATE` holds the unique step row until the transaction ends. Other transactions cannot change its attempt or status between the check and conditional update. Returning after the lock for an empty stamp is safe.

   Keep the `rowCount === 1` check on the subsequent update.

6. **`writeRawSource`: NO-SHIP.**

   Updating `verifiedAt` is wrong because this function verifies no object. The tests demonstrate the hole: they invent hashes such as `"d4".repeat(32)` without placing any corresponding object in the bucket, yet [`writeRawSource`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:816) creates a row claiming the object was verified now and commits a revision reference to it.

   A conflict can legitimately expose disagreement only as corruption:

   - Same digest and kind must imply the same byte count.
   - Stored content type is canonical for the kind.
   - Any differing existing value should throw, not be ignored.
   - Updating a shared `verifiedAt` is fine only when an actual bucket verification just happened.

   Pass a verification result/capability from `storeRawSource`, including its verification time, rather than treating an arbitrary `RawManifest` as proof. On conflict, compare `bytes` and `contentType`; refuse any mismatch.

7. **Backfill: provenance reasoning is right; the script is still NO-SHIP.**

   It is correct to preserve `backfilled` while computing `storedSha256` and `storedBytes` from the bytes in hand. Those are storage facts, not recovered origin provenance.

   Three implementation holes remain:

   - [`writeFile`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/backfill-raw-manifests.ts:141) overwrites `raw.json` directly. A crash or full disk can destroy the only manifest. Write a sibling temporary file and rename atomically.
   - The unchecked cast accepts `{kind: "html", file: "raw.pdf"}` and then stores PDF bytes under an HTML canonical key. Validate the manifest shape, require the filename implied by `kind`, and sniff the bytes before storing.
   - A manifest already containing both fields is skipped without checking that the object still exists and matches. That can report “already done” over a deleted or corrupt object.

   The dry run also does not compute the hash; it reports only kind and size.

8. **Tests that prove less than their names: NO-SHIP coverage gaps.**

   - The raw-read test explicitly expects `bytes: 0`, enshrining the broken reconstruction below.
   - “Writes the same manifest a fetch writes” checks neither `storedSha256` nor `storedBytes` in [`upload-acquire.test.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/upload-acquire.test.ts:88).
   - Raw-source write tests never seed or verify a bucket object, so they prove the adapter accepts a dangling object reference.
   - The stamp clash test changes prompt and model together; either individual comparison could disappear while it remained green.
   - The invalid-pair test calls `siteFor` directly, missing the state-dependent `has` bug below.
   - The no-`beginStep` test does not inspect whether rows were modified before refusal.
   - There are no backfill tests, including crash-safe manifest replacement and kind/file disagreement.

9. **Additional NO-SHIP: raw reads lose fields this landing just made durable.**

   [`readRaw`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:359) ignores:

   - `article_revisions.raw_byte_count`;
   - `article_revisions.raw_filename`;
   - `raw_sources.bytes`, which should become `storedBytes`.

   A newly written upload with `bytes: 4096`, `storedBytes: 4096`, and a filename reads back as `bytes: 0`, no `storedBytes`, and no filename. The test currently expects the `0`.

   Reassemble network `bytes` from `rawByteCount`, filename from `rawFilename`, and join the referenced `raw_sources` row for `storedBytes`.

10. **Additional NO-SHIP: uploaded manifests are refused by this adapter.**

    The upload path calls `storeRawSource` but discards its digest and writes neither required field into its manifest at [`pipeline.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:740). Every uploaded document therefore reaches Postgres without `storedSha256` or `storedBytes` and throws `NoStoredDocument`.

    Put `storedSha256: sha256` and `storedBytes: got.byteLength` into the upload manifest, and extend the existing “same manifest” test to require them.

11. **Additional bug: `hasArtefacts` can hide an invalid `(step, kind)` pair.**

    [`hasArtefacts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-pg.ts:540) reads the run row before validating requested kinds. Thus `has("arc", ["glossary"])` returns `false` when no completed arc row exists, but throws after one exists. Filesystem behaviour always throws.

    Validate all pairs with `siteFor` before the run-row early return.

12. **Known provenance loss.**

    Deriving `origin: "upload"` from both URLs being null is reasonable. `uploadId` is not durably recoverable from `jobs.upload_id`: publication clears the draft link, jobs can be deleted, and the revision retains no job identity. Add a revision-level upload reference or explicitly abandon that round-trip promise.

Validation: targeted lint and `git diff --check` passed. Root and web TypeScript projects passed direct `tsc`; the tests project has unrelated shared-tree errors. Vitest could not start because this review sandbox forbids its temporary-directory writes. No files were edited.