# Review: stage 2c of the files→Postgres migration, as built

Review **built code, not a plan**. Repository root: `/Users/greg/Dropbox/dev/experim/spideryarn2`.
This review decides whether it gets committed.

You have reviewed this migration four times and returned NO-SHIP each time; every finding was
accepted. Stage 1 landed as `6e3ee67`. **Stages 2a and 2b are under a separate review running in
parallel** — the seven article-reading stages, `blocks` and `toc`. This one is the two acquisition
stages, which are a different problem.

**The scoped diff (against `d9a0a3b`), with the new test file and a new postmortem appended in full:**
`/private/tmp/claude-501/-Users-greg-Dropbox-dev-experim-spideryarn2/e9d59148-0422-4f78-824d-44c35b090da5/scratchpad/stage2c.diff`

**The plan:** `docs/plans/finish-the-database-move.md` § Stage 2c.

## Scope warning

Six sessions share this tree. In `src/pipeline.ts`, **judge only the `fetch` and `extract` steps and
`acquireUpload`**. The deletion of the `summary` stage and the addition of a `timeline` stage are two
other sessions' work, on Greg's instruction, and are not under review. `src/toc.ts`, `src/blocks.ts`,
`src/labels.ts` and the seven article stages are the other review's.

## What this stage was asked to do, and the blocker that turned out to be false

Every other stage was converted by having it return its artefacts instead of writing them. These two
looked impossible on that pattern: `fetch` produces **bytes** as well as a manifest, and there is no
`ArtifactKind` for bytes. Both this plan and `docs/plans/transactional-stage-runner.md` said so.

**The seam already existed and neither document had noticed.** `writeRaw` already called
`storeRawSource` (`src/store/blobs.ts`), which puts the bytes in the content-addressed `sources`
bucket through an already-selected store; `storedSha256` and `storedBytes` were already fields on
`RawManifest`; and `writeRawSource` in `artifacts-pg.ts` already turned that manifest into the
`raw_sources` row and the reference columns. So `fetch` returns `parts: { raw: manifest }` and stops
writing three files, and `extract` fetches the bytes by content address.

## What was built (my account — verify it, do not trust it)

- **`readRawBytes(manifest, { slug?, store? })` in `src/fetch.ts`, as `writeRaw`'s inverse.** I had
  proposed putting it on `SourceStore`; the agent argued that down and I accepted. The reason is
  stronger than the content-type one I gave: `pgSourceStore.readPdf` resolves the slug through
  `articles.currentRevisionId` and `ownedSlug`, and stage 2 runs against a **draft** revision in a
  job with no request owner — a fresh ingest has no current revision at all, so a sibling method
  there answers `null` on the ordinary path. **Is that right?**
- **Store selection is `blobStore()`**, matching the write. Anything else is a split brain by
  construction.
- **`storedDocumentBytes(doc)`** exists so `writeRaw` hashes what `writeRawFiles` writes. The
  invariant broke once before: the CLI wrote `doc.bytes` while the pipeline wrote the decoded string
  to the same path, and stage 2 read that path as UTF-8.
- **`RawDocumentUnavailable` is classified `blocked`.** All three reasons mean the document is not
  there; Retry never re-runs a finished step, so a retry reads the same absent object. The fix is a
  refetch. **Is `blocked` right, or should `no-object` and `corrupt` differ from `missing`?**
- **`acquireUpload` moved with the fetched half** — it wrote `raw.pdf` and `raw.json` itself, which
  would have left the two origins ending in different places, and the whole design of the stage 1/2
  seam is that stage 3 onwards cannot tell them apart.
- **`keepTheOriginal` now calls `storeRawSource`**, which fixes every `npm run pdf` article having
  been un-ingestable into Postgres (`NoStoredDocument`).
- **The `npm run fetch` CLI still writes its two files.** The agent first made it diagnostic-only; I
  overruled that, because every other stage CLI writes what it always wrote and a person running it
  by hand still satisfies the queue's `fetch` step under `SPIDERYARN_STORE=files`. It prints the
  object key as well.

## The finding, which matters more than the conversion

**Nine of the eighteen local manifests name an object the reading process cannot see.** `blobStore()`
follows the credentials — Supabase when both are set, `data/_blobs/` otherwise — and only some of the
processes that fetched had called `loadEnvLocal()`. So the corpus was written across two stores
depending on how a process was started.

There was a writer, a name, a hash, and a verification on the way in. **There was no reader at all**,
so every check that existed passed, because every check that existed was on the write.
`docs/postmortems/a-write-path-with-no-reader.md` (appended to the diff) has both probes verbatim and
the counts: 30 directories, 18 with a manifest, 0 missing `storedSha256`, 9 objects on disk and 9 in
the bucket, disjoint.

Its conclusion is the part I want tested: **what would have caught this is not a better test of the
write — the write was verified twice — but a reader; a reference committed to durable storage needs
something that dereferences it on an ordinary path.** `pgSourceStore.readPdf` does, but only when
somebody clicks "view the original" on a PDF, so it never touched an HTML one. `db:export` would have
failed on nine articles — a backup tool is the wrong place to find this out.

**Is that the right lesson, and is the failure message the right response?** It names the article and
the key, says the likeliest cause is the two-store split, reports the two credentials **as observed**
without restating which adapter was chosen (a second copy of `blobStore()`'s rule is exactly how a
comment in `src/token-budget.ts` came to say something false about `src/toc.ts`), and tells the
reader to refetch — Greg's decision 4 is that the corpus is expendable.

## Two corrections the agent volunteered, which I want you to weigh

1. **A vacuous assertion it had already reported as a proof.** The test asserting the service-role
   key never appears in the message read `not.toContain(process.env.X ?? " never")`, which proves
   nothing where the variable is unset. It now sets both variables itself with a JWT-shaped
   sentinel, drives both branches, and adds a blank-credential case matching `postgresBlobStore`'s
   `.trim()` rule.
2. **A NUL byte written into a test file by one of its own scripted edits.** Vitest, esbuild and
   `tsc` all accepted it and the suite stayed green — but `grep` treats such a file as binary and
   returns nothing, silently, while `sed` prints it normally. That means a repo-wide grep sweep
   would skip a poisoned file and report clean. All files are clean now; `file -b` is the check.
   **Is there anything else in this repo that a poisoned file would have made invisible?**

## What I want from you

1. **Anything that will break at the flip** (`pgStoreSession` at `src/jobs.ts:1048`), and anything
   that breaks *now* on a laptop or a deployment that the tests cannot see.
2. **The three adjudications above**: where `readRawBytes` lives, the `blocked` classification, and
   the postmortem's lesson.
3. **The two legacy holes.** `readRaw` answers `null` for articles fetched before `raw.json` existed
   (two locally, `constitution` and `noema-mythology-of-conscious-ai`), and `RawManifest.file` is now
   a restatement of `kind` that `SHAPE.raw` still requires. Is either a trap?
4. **`src/jobs.ts` § `slugIsSpokenFor` still reads the manifest through the filesystem artefact
   store**, and its Postgres branch does not exist — `origin` is derivable from the two URLs being
   null and the upload id lives on `jobs.upload_id`. I have named that in the code as stage 3's. Is
   deferring it right?
5. Anything in the diff that is not stage 2c's business, and anything factually wrong above.

Be specific: file, line, the concrete state that fails. Say plainly where you are uncertain.

## Test status, honestly

`npm test`: **6,993 passing, 5 failing**, every failure attributable to another session by name —
four to the `summary` column leaving the store while `REVISION_CARRY_POLICY` still names it, one to
the `timeline` step having no fixture. None is mine, and I would rather you checked that than took
it.
