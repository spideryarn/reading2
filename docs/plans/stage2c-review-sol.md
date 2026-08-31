# NO-SHIP

Two stage-2c defects need fixing.

## Blocking findings

1. **`npm run fetch` can still create the exact two-store split described by the postmortem.**

   [`main()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/fetch.ts:1851) never calls `loadEnvLocal()`. On this laptop, importing `src/fetch.ts` left the environment at `SUPABASE_URL=true`, service key `false`; explicitly loading `.env.local` changed both to `true`.

   Consequently:

   - The CLI’s [`writeRaw()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/fetch.ts:1876) selects `data/_blobs/`.
   - It writes `raw.json`, so the filesystem queue considers fetch complete.
   - The server loads `.env.local` through [`src/store/live.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/live.ts:22), skips fetch, and extract reads from Supabase at [`src/pipeline.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1402).
   - Extraction then blocks on an object that does exist, but in the other store.

   The CLI test injects one store into both operations, so it cannot catch this process-start difference. The printed object key at [line 1896](/Users/greg/Dropbox/dev/experim/spideryarn2/src/fetch.ts:1896) also does not identify the adapter/location.

2. **An overlong corrupt object remains retryable.**

   [`readRawBytes()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/fetch.ts:425) passes `storedBytes` as `maxBytes`. Both adapters throw an ordinary `Error` when that limit is exceeded; see [`blobs-fs.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/blobs-fs.ts:71). It therefore never reaches the hash check or becomes `RawDocumentUnavailable("corrupt")`.

   The pipeline only converts `RawDocumentUnavailable` to blocked at [`src/pipeline.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1407). The ordinary error offers Retry, which skips fetch and fails identically. The test at [`stage2c-raw-bytes.test.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/tests/stage2c-raw-bytes.test.ts:258) only checks `/limit/`, masking the classification error.

## Adjudications

- **`readRawBytes` belongs in `src/fetch.ts`: yes.** It is the coherent inverse of `writeRaw`. `pgSourceStore.readPdf` joins through the owned, published current revision at [`pg-source.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/pg-source.ts:68), so it cannot serve a draft ingest without an owner.
- **`blocked` is right for missing, no-object and corrupt.** They all require refetch rather than retry. The overlong case must join that classification.
- **The postmortem’s main lesson is right but incomplete.** An ordinary dereference would expose the split promptly; stable store selection prevents creating it. The CLI currently proves that detection alone is insufficient.
- The failure message is useful and does not leak credentials. However, it trims credentials while [`blobStore()`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/blobs.ts:251) does not. With two whitespace-only values, the message and adapter choice disagree.

## Flip and legacy calls

- Deferring [`slugIsSpokenFor`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/jobs.ts:1950) to stage 3 is reasonable, but it is a **hard prerequisite to the Postgres flip**. Without its Postgres/jobs-table branch, retrying an existing upload treats its own slug as occupied and creates `slug-2`.
- The two pre-manifest articles will fail loudly and require refetch. Given the explicit expendable-corpus decision, no compatibility reader is required.
- Keeping `RawManifest.file` temporarily is safe for export and filesystem compatibility. [`SHAPE.raw`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts.ts:232) should eventually validate the live reference fields instead, but that is not a stage-2c blocker.
- `acquireUpload` selects a store at [line 1183](/Users/greg/Dropbox/dev/experim/spideryarn2/src/pipeline.ts:1183), then `storeRawSource` selects it again at line 1214. Environment stability makes that work ordinarily, but passing the selected store would make the invariant structural.

## Corrections and poisoned-file result

- The postmortem says “Three” bucket manifests and then lists four at [`a-write-path-with-no-reader.md`](/Users/greg/Dropbox/dev/experim/spideryarn2/docs/postmortems/a-write-path-with-no-reader.md:82).
- “Verified twice” overstates it: initial create-only and dedup reread are alternative paths, not two verifications of every write.
- [`artifacts-fs.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/store/artifacts-fs.ts:689) incorrectly says missing blobs still raise `ENOENT` and produce 404. The adapter converts `ENOENT` to `null`; `RawDocumentUnavailable` consequently reaches the route as 500.
- The new stage-2c files contain no NUL. However, committed [`src/html.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/src/html.ts:70) already contains two literal NUL bytes. `file` calls it `data`; grep/rg suppress useful matches, Git can hide textual diffs as binary, and [`scripts/count-lines.ts`](/Users/greg/Dropbox/dev/experim/spideryarn2/scripts/count-lines.ts:317) omits the whole file. Thus “all files are clean” is false, although this predates stage 2c.

No other stage-2c scope creep stood out; I excluded the named summary, timeline, and stage-2a/2b changes.

## Verification

- Focused stage-2c/source/upload/failure tests: **66/66 passed**.
- Typecheck: **775 files passed** using the direct runner; the standard wrapper could not create its IPC socket in this read-only sandbox.
- Equivalent full Vitest run: **6 failed files, 5 failed tests, 6,617 passed, 383 skipped**. The failures were shared-database contention, another session’s summary-policy change, and two chat timeouts. None implicates stage 2c, but the live tree no longer reproduces the supplied 6,993/5 snapshot exactly.

